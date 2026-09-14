/**
 * Nanogramics | nanogramics_pos_1.5 - ELECTRON MAIN PROCESS
 * Updated: Permission system, designation, description, status support
 */

const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os   = require('os');
const fs   = require('fs');

const DatabaseService = require('./backend/database');
const BackupService   = require('./backend/backup');
const AuthService     = require('./backend/auth');
const { InvoicePdfService, migrateInvoicePdf, renderElectronPdf, pdfFilename } = require('./backend/invoice-pdf');
let invoicePdfs;
const { ShopService, migrateShop } = require('./backend/shop');
let shopService;

let mainWindow;
let db          = null;
let backupService = null;
let currentUser = null;

// ── PAGE → IPC PERMISSION MAP ─────────────────────────────────────
// Maps each page/tab to the IPC actions it covers.
// Used by requirePermission() to enforce backend access control.
const PAGE_PERMISSIONS = {
  wholesale: ['wholesale:sale:create'],
  shop: ['shop:issue', 'shop:list', 'shop:details', 'shop:locations'],
  sales:     ['db:sale:create', 'db:sale:getAll', 'db:sale:getById', 'db:sale:getByDateRange', 'db:sale:delete'],
  inventory: ['db:category:add', 'db:category:delete', 'db:product:add', 'db:product:update', 'db:product:delete', 'db:product:updateStock'],
  online:    ['db:onlineOrder:create', 'db:onlineOrder:getAll', 'db:onlineOrder:getByDate',
              'db:onlineOrder:updateStatus', 'db:onlineOrder:delete', 'db:onlineOrder:getByDateRange', 'db:onlineOrder:update',
              'db:onlineOrder:bulkUpdateStatus'],
  returns:   ['db:return:process', 'db:return:getList', 'db:return:getInvoice', 'db:onlineReturn:process',
              'db:simpleOnlineReturn:process', 'db:simpleOnlineReturn:getList'],
  exchange:  ['exchange:invoice:lookup', 'db:exchange:process', 'db:exchange:getList'],
  reports:   ['db:report:getSalesReport', 'db:report:getFullReport', 'db:report:getUserPerformance'],
  audit:     ['db:audit:getLogs', 'db:audit:clearOld'],
  settings:  ['db:setting:get', 'db:setting:set', 'db:user:getAll', 'db:user:add', 'db:user:update', 'db:user:delete'],
};

// Build reverse map: channel → page
const CHANNEL_PAGE_MAP = {};
Object.entries(PAGE_PERMISSIONS).forEach(([page, channels]) => {
  channels.forEach(ch => { CHANNEL_PAGE_MAP[ch] = page; });
});

// ── AUTH HELPERS ──────────────────────────────────────────────────

function requireAuth(actionName = 'This action') {
  if (!currentUser) throw new Error(`${actionName} requires an authenticated user.`);
  return currentUser;
}

function requireAdmin(actionName = 'This action') {
  requireAuth(actionName);
  if (currentUser.role !== 'admin') throw new Error(`${actionName} requires admin access.`);
}

/**
 * requirePermission — checks page access for non-admin users.
 * Admins always bypass. If user has no permissions set (legacy), allows access.
 */
function requirePermission(channel) {
  requireAuth(channel);
  if (currentUser.role === 'admin') return; // admins have full access

  // Check if user is active
  if (currentUser.status === 'inactive') {
    throw new Error('Your account has been deactivated. Please contact an administrator.');
  }

  const page = CHANNEL_PAGE_MAP[channel];
  if (!page) return; // unmapped channel — allow by default

  let permissions = [];
  try { permissions = JSON.parse(currentUser.permissions || '[]'); } catch (e) { permissions = []; }

  // Legacy behavior: if no permissions assigned, allow access (backward compatible)
  if (permissions.length === 0) return;

  if (!permissions.includes(page)) {
    throw new Error(`Access denied: You do not have permission to access "${page}". Please contact your administrator.`);
  }
}

// ── NORMALIZE HELPERS ──────────────────────────────────────────────

function normalizeInvoiceForClient(invoice, invoiceType) {
  if (!invoice) return null;
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  return {
    ...invoice,
    id: invoice.id,
    isOnline: invoiceType === 'online',
    items,
    customer_name:    invoice.customer_name    || invoice.customer?.name    || invoice.customerName    || 'Walk-in',
    customer_phone:   invoice.customer_phone   || invoice.customer?.phone   || invoice.customerPhone   || '',
    customer_address: invoice.customer_address || invoice.customer?.address || invoice.customerAddress || '',
    total:    Number(invoice.total    || invoice.amount || 0),
    subtotal: Number(invoice.subtotal || 0),
    discount: Number(invoice.discount || 0),
    delivery: Number(invoice.delivery || 0),
  };
}

function normalizeItemList(value) {
  if (Array.isArray(value)) return value.filter(i => i !== null && i !== undefined);
  if (value && typeof value === 'object') {
    if (Array.isArray(value.items))    return value.items.filter(i => i !== null && i !== undefined);
    if (Array.isArray(value.newItems)) return value.newItems.filter(i => i !== null && i !== undefined);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.filter(i => i !== null && i !== undefined) : [];
    } catch (e) {
      return trimmed.split(',').map(p => p.trim()).filter(Boolean).map(p => ({ name: p, qty: 1 }));
    }
  }
  return [];
}

function normalizeReturnItems(value, fallbackInvoiceItems = [], fallbackQty = 0) {
  const sourceItems  = Array.isArray(value) ? value : normalizeItemList(value);
  const invoiceItems = Array.isArray(fallbackInvoiceItems) ? fallbackInvoiceItems : [];
  const effectiveItems = sourceItems.length > 0 ? sourceItems : invoiceItems;
  return effectiveItems.map((item, index) => {
    const normalizedQty = Number(item?.qty ?? item?.quantity ?? item?.returnQty ?? fallbackQty ?? 0);
    const qty = Number.isFinite(normalizedQty) && normalizedQty > 0 ? normalizedQty : 0;
    return {
      ...item,
      itemIndex:    item?.itemIndex ?? item?.index ?? index,
      qty,
      code:         item?.code         || item?.product_code || item?.sku || '',
      name:         item?.name         || item?.product_name || item?.description || '',
      price:        Number(item?.price ?? item?.subtotal ?? item?.unitPrice ?? 0),
      product_code: item?.product_code || item?.code        || item?.sku || ''
    };
  }).filter(item => item.qty > 0);
}

// ── DIRECTORIES ───────────────────────────────────────────────────

// Keep the installed Lajpal POS storage identity when changing the display name.
// Existing installations use this directory (including the established nested data path).
const LEGACY_USER_DATA_DIR = path.join(app.getPath('appData'), 'lajpal-brand-hub-pos');
const APP_DATA_DIR = app.isPackaged ? path.join(LEGACY_USER_DATA_DIR, 'data') : path.join(os.homedir(), '.lajpal-pos');
const DB_PATH      = path.join(APP_DATA_DIR, 'pos_system.db');
const BACKUP_DIR   = path.join(APP_DATA_DIR, 'backups');
const LOGS_DIR     = path.join(APP_DATA_DIR, 'logs');
const CACHE_DIR    = path.join(APP_DATA_DIR, 'cache');
const TEMP_DIR     = path.join(APP_DATA_DIR, 'temp');

[APP_DATA_DIR, BACKUP_DIR, LOGS_DIR, CACHE_DIR, TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

app.setPath('userData', APP_DATA_DIR);
app.setPath('cache', CACHE_DIR);
app.setPath('temp', TEMP_DIR);

// ── WINDOW ────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Nanogramics | nanogramics_pos_1.5',
    width: 1400, height: 900,
    minWidth: 1200, minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  const prodIndexPath = path.join(__dirname, 'dist', 'renderer', 'index.html');
  const devIndexPath = path.join(__dirname, 'frontend', 'index.html');
  const indexPath = fs.existsSync(prodIndexPath) ? prodIndexPath : devIndexPath;

  mainWindow.loadFile(indexPath);
  if (process.argv.includes('--dev')) mainWindow.webContents.openDevTools();
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── APP READY ─────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    db = new DatabaseService();
    await db.initialize();
    await migrateShop(db);
    shopService = new ShopService(db);
    await migrateInvoicePdf(db);
    await require('./backend/adjustment-reports').migrate(db);
    invoicePdfs = new InvoicePdfService({ db, directory: path.join(path.dirname(db.dbPath), 'invoice-pdfs'), renderPdf: html => renderElectronPdf(BrowserWindow, html) });
    backupService = new BackupService(DB_PATH, BACKUP_DIR);
    if (backupService && typeof backupService.setupAutoBackup === 'function') {
      backupService.setupAutoBackup();
    }
    createWindow();
    setupMenu();
    invoicePdfs.retryPending().catch(error => console.error('Invoice PDF recovery failed:', error));
    console.log('Application Started Successfully');
  } catch (error) {
    console.error('Startup Error:', error);
    dialog.showErrorBox('Startup Error', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── MENU ──────────────────────────────────────────────────────────

function setupMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Backup Database',
          click: async () => {
            try {
              const backup = await backupService.createBackup();
              dialog.showMessageBox(mainWindow, { type: 'info', title: 'Backup Created', message: `Backup saved:\n${backup}` });
            } catch (error) { dialog.showErrorBox('Backup Error', error.message); }
          }
        },
        { type: 'separator' },
        { label: 'Exit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }]
    },
    {
      label: 'Help',
      submenu: [{
        label: 'About',
        click: () => dialog.showMessageBox(mainWindow, {
          type: 'info', title: 'About',
          message: 'Nanogramics',
          detail: 'nanogramics_pos_1.5\nOffline POS System\n\nSoftware Developed by Nanogramics\nnanogramics.tech'
        })
      }]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ════════════════════════════════════════════════════════════════════
// ── AUTH IPC ─────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

ipcMain.handle('db:user:authenticate', async (event, username, password) => {
  try {
    if (!username || !username.trim()) throw new Error('Please enter your username');
    if (!password) throw new Error('Please enter your password');

    const users = await db.queryRows('SELECT * FROM users WHERE username = ?', [username.trim()]);
    if (users.length === 0) throw new Error('Username not found. Please check and try again.');

    const user = users[0];

    // Check if account is active
    if (user.status === 'inactive') {
      throw new Error('Your account has been deactivated. Please contact an administrator.');
    }

    const authService = new AuthService();
    const valid = await authService.verifyPassword(password, user.password_hash);
    if (!valid) throw new Error('Incorrect password. Please try again.');

    // Store full user data in currentUser (including permissions)
    currentUser = {
      id:          user.id,
      username:    user.username,
      role:        user.role,
      designation: user.designation || '',
      description: user.description || '',
      permissions: user.permissions || '[]',
      status:      user.status      || 'active',
    };

    // Return full user data to frontend
    return {
      id:          user.id,
      username:    user.username,
      role:        user.role,
      designation: user.designation || '',
      description: user.description || '',
      permissions: user.permissions || '[]',
      status:      user.status      || 'active',
    };
  } catch (error) { console.error('Auth Error:', error.message); throw error; }
});

// ════════════════════════════════════════════════════════════════════
// ── USER MANAGEMENT IPC ──────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

ipcMain.handle('db:user:getAll', async () => {
  try {
    requirePermission('db:user:getAll');
    return await db.queryRows(
      'SELECT id, username, role, designation, description, permissions, status, created_at, updated_at FROM users ORDER BY id ASC'
    );
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:user:logout', async () => {
  try {
    currentUser = null;
    return { success: true };
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:user:add', async (event, user) => {
  try {
    requirePermission('db:user:add');
    const {
      username, password, role,
      designation = '', description = '',
      permissions = '[]', status = 'active'
    } = user;

    if (!username || !password) throw new Error('Username and password required');

    const existing = await db.queryRows('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) throw new Error('Username already exists');

    const authService = new AuthService();
    const hash        = await authService.hashPassword(password);

    // Normalize permissions to JSON string
    const permsStr = Array.isArray(permissions)
      ? JSON.stringify(permissions)
      : (typeof permissions === 'string' ? permissions : '[]');

    await db.exec(
      `INSERT INTO users (username, password_hash, role, designation, description, permissions, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [username, hash, role || 'cashier', designation, description, permsStr, status || 'active', new Date().toISOString()]
    );
    return { success: true };
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:user:update', async (event, userId, updates) => {
  try {
    requirePermission('db:user:update');
    const {
      role, password,
      designation = '', description = '',
      permissions = '[]', status = 'active'
    } = updates;

    // Normalize permissions to JSON string
    const permsStr = Array.isArray(permissions)
      ? JSON.stringify(permissions)
      : (typeof permissions === 'string' ? permissions : '[]');

    if (password) {
      const authService = new AuthService();
      const hash        = await authService.hashPassword(password);
      await db.exec(
        `UPDATE users SET role = ?, password_hash = ?, designation = ?, description = ?,
         permissions = ?, status = ?, updated_at = ? WHERE id = ?`,
        [role, hash, designation, description, permsStr, status, new Date().toISOString(), userId]
      );
    } else {
      await db.exec(
        `UPDATE users SET role = ?, designation = ?, description = ?,
         permissions = ?, status = ?, updated_at = ? WHERE id = ?`,
        [role, designation, description, permsStr, status, new Date().toISOString(), userId]
      );
    }
    return { success: true };
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:user:delete', async (event, userId) => {
  try {
    requirePermission('db:user:delete');
    const admins = await db.queryRows("SELECT id FROM users WHERE role = 'admin'");
    const user   = await db.queryRows('SELECT role FROM users WHERE id = ?', [userId]);
    if (user[0]?.role === 'admin' && admins.length <= 1) throw new Error('Cannot delete the last admin');
    await db.exec('DELETE FROM users WHERE id = ?', [userId]);
    return { success: true };
  } catch (error) { console.error(error); throw error; }
});

// ════════════════════════════════════════════════════════════════════
// ── PRODUCTS IPC ─────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

ipcMain.handle('db:category:getAll', async () => {
  requireAuth('Viewing categories');
  return db.queryRows('SELECT * FROM categories ORDER BY name COLLATE NOCASE');
});
ipcMain.handle('db:category:add', async (event, name) => {
  requirePermission('db:category:add');
  if (typeof name !== 'string' || !name.trim()) throw new Error('Category name is required');
  name = name.trim();
  if (name.length > 100) throw new Error('Category name must be 100 characters or fewer');
  return db.runTransaction(async tx => {
    const existing = await tx.queryRows('SELECT id FROM categories WHERE lower(trim(name)) = lower(?)', [name]);
    if (existing.length) throw new Error('Category already exists');
    await tx.exec('INSERT INTO categories (name, created_at) VALUES (?, ?)', [name, new Date().toISOString()]);
    return { success: true };
  });
});
ipcMain.handle('db:category:delete', async (event, id) => {
  requirePermission('db:category:delete');
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid category');
  try {
    const result = await db.exec('DELETE FROM categories WHERE id = ?', [id]);
    if (!result.changes) throw new Error('Category no longer exists');
    return { success: true };
  } catch (error) {
    if (error.message.includes('Category is in use')) throw new Error('Reassign products to another category before deleting this category.');
    throw error;
  }
});

ipcMain.handle('db:product:getAll', async () => {
  try {
    requireAuth('Viewing products');
    return await db.queryRows('SELECT * FROM products ORDER BY name ASC');
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:product:getByCode', async (event, code) => {
  try {
    requireAuth('Viewing product details');
    return await db.queryRows('SELECT * FROM products WHERE code = ?', [code]);
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:product:add', async (event, product) => {
  try {
    requirePermission('db:product:add');
    const { code, name, brand, price, qty, category } = product;
    if (!name) throw new Error('Product name required');
    const productCode = code || 'P-' + Date.now();
    const existing = await db.queryRows('SELECT id FROM products WHERE code = ?', [productCode]);
    if (existing.length > 0) throw new Error('Product code already exists');
    await db.exec(
      'INSERT INTO products (code, name, brand, type, price, qty, desc, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [productCode, name, brand || '', '', Number(price) || 0, Number(qty) || 0, '', category || '', new Date().toISOString()]
    );
    return { success: true };
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:product:update', async (event, product) => {
  try {
    requirePermission('db:product:update');
    const { code, name, brand, price, qty, category } = product;
    await db.exec(
      'UPDATE products SET name = ?, brand = COALESCE(?, brand), price = ?, qty = ?, category = ?, updated_at = ? WHERE code = ?',
      [name, brand ?? null, Number(price), Number(qty) || 0, category || '', new Date().toISOString(), code]
    );
    return { success: true };
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:product:delete', async (event, code) => {
  try {
    requirePermission('db:product:delete');
    await db.exec('DELETE FROM products WHERE code = ?', [code]);
    return { success: true };
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:product:updateStock', async (event, code, qty) => {
  try {
    requirePermission('db:product:updateStock');
    await db.exec('UPDATE products SET qty = qty + ? WHERE code = ?', [qty, code]);
    return { success: true };
  } catch (error) { console.error(error); throw error; }
});

// ════════════════════════════════════════════════════════════════════
// ── SALES IPC ────────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

ipcMain.handle('shop:issue', async (_event, data) => {
  requirePermission('shop:issue');
  return shopService.issue(data, requireAuth('Shop stock issue'));
});
ipcMain.handle('shop:list', async (_event, page = 0) => {
  requirePermission('shop:list');
  return shopService.list(page);
});
ipcMain.handle('shop:details', async (_event, id) => {
  requirePermission('shop:details');
  return shopService.details(id);
});
ipcMain.handle('shop:locations', async () => {
  requirePermission('shop:locations');
  return db.queryRows("SELECT name FROM stock_locations WHERE kind='shop' AND status='active' ORDER BY name");
});

ipcMain.handle('db:sale:create', async (event, sale) => {
  try {
    requirePermission(sale?.notes === 'WHOLESALE' ? 'wholesale:sale:create' : 'db:sale:create');
    const user = requireAuth('Creating sales');
    console.log('=== SAVING SALE ===', JSON.stringify(sale));
    const { id, items, subtotal, discount, cashback, delivery, tax, total, payment_method, payment_status, notes } = sale;
    if (!id) throw new Error('Sale invoice ID is required');
    if (!Array.isArray(items) || items.length === 0) throw new Error('Sale must include at least one item');

    const saleUserId = Number(sale.user_id || user.id || 1);
    const now = new Date().toISOString();

    const saved = await db.runTransaction(async (tx) => {
      const existing = await tx.queryRows('SELECT id FROM sales WHERE id = ?', [id]);
      if (existing.length > 0) throw new Error(`Duplicate sale detected for invoice ${id}`);

      if (notes === 'WHOLESALE') {
        let expected = 0; const quantities = new Map();
        for (const item of items) {
          if (!Number.isInteger(item.qty) || item.qty < 1 || !Number.isFinite(item.price) || item.price < 0) throw Error('Invalid wholesale quantity or price');
          quantities.set(item.code, (quantities.get(item.code) || 0) + item.qty); expected += item.qty * item.price;
        }
        for (const [code, qty] of quantities) { const [p] = await tx.queryRows('SELECT qty FROM products WHERE code = ?', [code]); if (!p || qty > Number(p.qty)) throw Error('Insufficient wholesale stock'); }
        if (![subtotal, discount, delivery, total].every(Number.isFinite) || discount < 0 || discount > expected || delivery < 0 || Math.abs(subtotal-expected)>0.011 || Math.abs(total-(expected-discount+delivery))>0.011) throw Error('Invalid wholesale totals');
      }
      await tx.exec(
        `INSERT INTO sales (id, user_id, subtotal, discount, cashback, delivery, tax, total, payment_method, payment_status, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, saleUserId, subtotal, discount || 0, cashback || 0, delivery || 0, tax || 0, total,
         payment_method || 'cash', payment_status || 'paid', notes || '', now]
      );

      // Persist invoice-only details alongside the original sale, never a second sale.
      const invoiceItems = [];
      for (const item of items) {
        const iQty   = parseInt(item.qty)     || 1;
        const iPrice = parseFloat(item.price) || 0;
        const code   = item.code || '';
        const [product] = code ? await tx.queryRows('SELECT * FROM products WHERE code = ?', [code]) : [];
        invoiceItems.push({ size: item.size ?? product?.size ?? '', variant: item.variant ?? product?.variant ?? '' });
        await tx.exec(
          `INSERT INTO sale_items (sale_id, product_code, product_name, brand, type, qty, price, subtotal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, code, item.name || '', item.brand || '', item.type || '', iQty, iPrice, iQty * iPrice]
        );
        if (code) {
          await tx.exec(
            'UPDATE products SET qty = CASE WHEN qty - ? < 0 THEN 0 ELSE qty - ? END WHERE code = ?',
            [iQty, iQty, code]
          );
        }
      }

      await tx.exec('UPDATE sales SET invoice_details_json = ? WHERE id = ?', [JSON.stringify({
        cashier: user.username || sale.cashier || '',
        cashReceived: sale.cashReceived ?? sale.cash_received ?? null,
        customer_name: sale.customer_name || sale.customer?.name || sale.customerName || '',
        customer_phone: sale.customer_phone || sale.customer?.phone || sale.customerPhone || '',
        customer_address: sale.customer_address || sale.customer?.address || sale.customerAddress || '',
        items: invoiceItems
      }), id]);

      await tx.exec(
        `INSERT INTO audit_log (timestamp, user_id, username, user_role, system_type, action, invoice_number, customer_name, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          now,
          saleUserId,
          user.username || 'system',
          user.role || 'cashier',
          'Offline',
          'Offline Sale Created',
          id,
          'Walk-in',
          `Sale ${id} — Rs ${total} — ${items.length} item(s) — ${payment_method || 'cash'}`,
          now,
        ]
      );

      return { success: true, message: 'Sale completed' };
    });
    // The transaction is committed. PDF failure must never report the sale as failed.
    let pdf;
    try { pdf = await invoicePdfs.generate(id); }
    catch (error) { console.error('Post-save invoice PDF failed:', error); pdf = { success: false, error: error.message }; }
    return { ...saved, invoiceId: id, pdf };
  } catch (error) {
    console.error(error);
    throw error;
  }
});

ipcMain.handle('db:sale:getAll', async () => {
  try {
    requirePermission('db:sale:getAll');
    return await db.queryRows('SELECT * FROM sales ORDER BY created_at DESC');
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('invoice:pdf:list', async (_event, search = '') => {
  requirePermission('db:sale:getAll');
  return db.queryRows("SELECT id, created_at, total, pdf_status, pdf_error FROM sales WHERE id LIKE ? ORDER BY created_at DESC LIMIT 100", [`%${String(search).slice(0, 100)}%`]);
});

ipcMain.handle('invoice:pdf:generate', async (_event, id) => {
  requirePermission('db:sale:getById');
  return invoicePdfs.generate(String(id));
});

ipcMain.handle('invoice:pdf:open', async (_event, id) => {
  // Invoice viewing is available from either Sales or Reports; deletion stays admin-only.
  try { requirePermission('db:sale:getById'); }
  catch (_) { requirePermission('db:report:getFullReport'); }
  // Re-create missing files, and derive the path from the ID rather than client input.
  const result = await invoicePdfs.generate(String(id));
  if (!result.success) return result;
  const error = await shell.openPath(path.join(invoicePdfs.directory, pdfFilename(id)));
  return error ? { success: false, error } : result;
});

ipcMain.handle('db:sale:getById', async (event, id) => {
  try {
    requirePermission('db:sale:getById');
    const sale  = await db.queryRows('SELECT * FROM sales WHERE id = ?', [id]);
    const items = await db.queryRows('SELECT * FROM sale_items WHERE sale_id = ?', [id]);
    if (sale.length === 0) throw new Error('Sale not found');
    return { ...sale[0], items };
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:sale:getByDateRange', async (event, startDate, endDate) => {
  try {
    requirePermission('db:sale:getByDateRange');
    return await db.queryRows(
      "SELECT * FROM sales WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at DESC",
      [startDate, endDate]
    );
  } catch (error) { console.error(error); throw error; }
});

ipcMain.handle('db:sale:delete', async (event, saleId) => {
  try {
    requireAdmin('Deleting sales');
    await db.exec('DELETE FROM sale_items WHERE sale_id = ?', [saleId]);
    await db.exec('DELETE FROM sales WHERE id = ?', [saleId]);
    return { success: true };
  } catch (error) { console.error(error); throw error; }
});

// ════════════════════════════════════════════════════════════════════
// ── REPORTS IPC ──────────────────────────────────────────────────
// ════════════════════════════════════════════════════════════════════

ipcMain.handle('db:report:getSalesReport', async (event, startDate, endDate) => {
  try {
    requirePermission('db:report:getSalesReport');
    const sales = await db.queryRows("SELECT * FROM sales WHERE date(created_at) BETWEEN ? AND ?", [startDate, endDate]);
    let items = [];
    if (sales.length > 0) {
      const ids = sales.map(s => `'${s.id}'`).join(',');
      items = await db.queryRows(`SELECT * FROM sale_items WHERE sale_id IN (${ids})`);
    }
    const totalRevenue  = sales.reduce((s, r) => s + Number(r.total    || 0), 0);
    const totalDiscount = sales.reduce((s, r) => s + Number(r.discount || 0), 0);
    const totalItems    = items.reduce((s, i) => s + Number(i.qty      || 0), 0);
    const byProduct = {};
    items.forEach(item => {
      if (!byProduct[item.product_code]) byProduct[item.product_code] = { code: item.product_code, name: item.product_name, brand: item.brand || '', qty: 0, times: 0, revenue: 0 };
      byProduct[item.product_code].qty     += Number(item.qty     || 0);
      byProduct[item.product_code].times   += 1;
      byProduct[item.product_code].revenue += Number(item.subtotal || 0);
    });
  return { summary: { totalSales: sales.length, totalRevenue, totalDiscount, totalItems, averageOrderValue: sales.length > 0 ? totalRevenue / sales.length : 0 }, itemBreakdown: Object.values(byProduct), sales };
  } catch (error) { console.error(error); throw error; }
});

  // ── DATABASE INTEGRITY IPC ───────────────────────────────────────
  ipcMain.handle('db:integrity:check', async () => {
    try {
      requireAdmin('Checking database integrity');
      return await db.verifyDataIntegrity();
    } catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('db:integrity:checkDuplicate', async (event, orderId) => {
    try {
      requireAuth('Checking for duplicate order');
      return await db.checkDuplicateOrder(orderId);
    } catch (error) { console.error(error); throw error; }
  });

  // ── SETTINGS IPC ──────────────────────────────────────────────────
  ipcMain.handle('db:setting:get', async (event, key) => {
    try {
      requireAuth('Reading settings');
      const rows = await db.queryRows('SELECT value FROM settings WHERE key = ?', [key]);
      return rows.length > 0 ? rows[0].value : null;
    } catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('db:setting:set', async (event, key, value) => {
    try {
      requirePermission('db:setting:set');
      const existing = await db.queryRows('SELECT key FROM settings WHERE key = ?', [key]);
      if (existing.length > 0) {
        await db.exec('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
      } else {
        await db.exec('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
      }
      return { success: true };
    } catch (error) { console.error(error); throw error; }
  });

  // ════════════════════════════════════════════════════════════════════
  // ── ONLINE ORDERS IPC ────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:onlineOrder:create', async (event, order) => {
    try {
      requirePermission('db:onlineOrder:create');
    console.log('=== SAVING ONLINE ORDER ===', JSON.stringify(order));
    const id               = order.id                   || ('ORD-' + Date.now());
    const customer         = order.customer             || {};
    const items            = Array.isArray(order.items) ? order.items : [];
    const normalizedItems  = items.map(item => ({
      id:    item.id    || item.code || '',
      code:  item.code  || item.id   || '',
      name:  item.name  || '',
      price: parseFloat(item.price) || 0,
      qty:   parseInt(item.qty, 10) || 0,
    })).filter(item => item.code && item.qty > 0);

    if (normalizedItems.length === 0) throw new Error('At least one product is required');

    const computedSubtotal = normalizedItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const subtotal         = parseFloat(order.subtotal) || computedSubtotal;
    const delivery         = parseFloat(order.delivery) || 0;
    const discount         = parseFloat(order.discount) || 0;
    const total            = parseFloat(order.total)    || Math.max(0, subtotal + delivery - discount);
    const paymentStatus    = order.paymentStatus        || 'cod';
    const orderStatus      = order.orderStatus          || 'pending';
    const notes            = order.notes               || '';
    const weight           = parseFloat(order.weight)   || 0;
    const city             = order.city || customer.city || '';
    const created_at       = order.created_at           || new Date().toISOString();
    const qtyOfGoods       = normalizedItems.reduce((sum, item) => sum + item.qty, 0);
    const goodsDescription = normalizedItems.map(item => `${item.qty} x ${item.name}`).join(', ');
    const custName  = customer.name    || '';
    const custPhone = customer.phone   || '';
    const custAddr  = customer.address || '';

    const existingOrder = await db.queryRows('SELECT id FROM online_orders WHERE id = ?', [id]);
    if (existingOrder.length > 0) throw new Error(`Duplicate online order detected for ${id}`);
    if (!custName)  throw new Error('Customer name is required');
    if (!custPhone) throw new Error('Customer phone is required');

    await db.exec(
      `INSERT INTO online_orders
       (id, customer_name, customer_phone, customer_address, city,
        items_json, subtotal, delivery, discount, total,
        payment_status, order_status, notes, weight, qty_of_goods, goods_description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, custName, custPhone, custAddr, city, JSON.stringify(normalizedItems), subtotal, delivery, discount, total,
       paymentStatus, orderStatus, notes, weight, qtyOfGoods, goodsDescription, created_at]
    );

    const pieces = qtyOfGoods;
    if (custName && pieces >= 0) {
      const userId   = order.userId   || order.user_id || 0;
      const username = order.username || order.createdBy || '';
      if (username) {
        await db.exec(
          `INSERT INTO user_performance_log (user_id, username, order_id, order_type, pieces, amount, is_return, created_at)
           VALUES (?, ?, ?, 'online', ?, ?, 0, ?)`,
          [userId, username, id, pieces, total, created_at]
        );
      }
    }
    return { success: true, id };
  } catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('db:onlineOrder:getAll', async () => {
    try {
      requirePermission('db:onlineOrder:getAll');
      const rows = await db.queryRows('SELECT * FROM online_orders ORDER BY created_at DESC');
      return rows.map(r => ({ ...r, items: r.items_json ? JSON.parse(r.items_json) : [], customer: { name: r.customer_name, phone: r.customer_phone, address: r.customer_address } }));
    } catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('db:onlineOrder:getByDate', async (event, dateStr) => {
    try {
      requirePermission('db:onlineOrder:getByDate');
      const rows = await db.queryRows("SELECT * FROM online_orders WHERE date(created_at) = ? ORDER BY created_at DESC", [dateStr]);
      return rows.map(r => ({ ...r, items: r.items_json ? JSON.parse(r.items_json) : [], customer: { name: r.customer_name, phone: r.customer_phone, address: r.customer_address } }));
    } catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('db:onlineOrder:getByDateRange', async (event, startDate, endDate) => {
    try {
      requirePermission('db:onlineOrder:getByDateRange');
      const rows = await db.queryRows("SELECT * FROM online_orders WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at DESC", [startDate, endDate]);
      return rows.map(r => ({ ...r, items: r.items_json ? JSON.parse(r.items_json) : [], customer: { name: r.customer_name, phone: r.customer_phone, address: r.customer_address } }));
    } catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('db:onlineOrder:updateStatus', async (event, orderId, status) => {
    try {
      requirePermission('db:onlineOrder:updateStatus');
      const valid = ['pending', 'shipping', 'delivered', 'return'];
      if (!valid.includes(status)) throw new Error('Invalid status: ' + status);
      const oldRows = await db.queryRows('SELECT order_status FROM online_orders WHERE id = ?', [orderId]);
      if (oldRows.length === 0) throw new Error('Order not found');
      const oldStatus = oldRows[0]?.order_status || 'pending';
      await db.exec('UPDATE online_orders SET order_status = ? WHERE id = ?', [status, orderId]);

      if (status === 'return' && oldStatus !== 'return') {
        const order = await db.queryRows('SELECT * FROM online_orders WHERE id = ?', [orderId]);
        if (order.length > 0) {
          const o = order[0];
          const items = o.items_json ? JSON.parse(o.items_json) : [];

          for (const item of items) {
            const code = item.code || item.id || '';
            const qty = parseInt(item.qty) || 0;
            if (code && qty > 0) {
              await db.exec('UPDATE products SET qty = qty + ? WHERE code = ?', [qty, code]);
            }
          }

          const pieces = items.reduce((s, i) => s + (parseInt(i.qty) || 1), 0) || 1;
          const perfLog = await db.queryRows('SELECT * FROM user_performance_log WHERE order_id = ? AND is_return = 0 LIMIT 1', [orderId]);
          if (perfLog.length > 0) {
            const p = perfLog[0];
            await db.exec(`INSERT INTO user_performance_log (user_id, username, order_id, order_type, pieces, amount, is_return, created_at) VALUES (?, ?, ?, 'online', ?, ?, 1, ?)`,
              [p.user_id, p.username, orderId, pieces, o.total || 0, new Date().toISOString()]
            );
          }
        }
      }

      if (oldStatus === 'return' && status !== 'return') {
        const order = await db.queryRows('SELECT * FROM online_orders WHERE id = ?', [orderId]);
        if (order.length > 0) {
          const o = order[0];
          const items = o.items_json ? JSON.parse(o.items_json) : [];
          for (const item of items) {
            const code = item.code || item.id || '';
            const qty = parseInt(item.qty) || 0;
            if (code && qty > 0) {
              await db.exec('UPDATE products SET qty = CASE WHEN qty - ? < 0 THEN 0 ELSE qty - ? END WHERE code = ?', [qty, qty, code]);
            }
          }
        }
        await db.exec('DELETE FROM user_performance_log WHERE order_id = ? AND is_return = 1', [orderId]);
      }
      return { success: true };
    } catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('db:onlineOrder:update', async (event, order) => {
    try {
      requirePermission('db:onlineOrder:update');
      const {
        id, customer, items, subtotal, delivery, discount, total,
        paymentStatus, orderStatus, notes, weight, city
      } = order;

      if (!id) throw new Error('Order ID is required');

      const normalizedItems = Array.isArray(items) ? items.map(item => ({
        id:    item.id    || item.code || '',
        code:  item.code  || item.id   || '',
        name:  item.name  || '',
        price: parseFloat(item.price) || 0,
        qty:   parseInt(item.qty, 10) || 0,
      })).filter(item => item.code && item.qty > 0) : [];

      const computedSubtotal = normalizedItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
      const finalSubtotal = parseFloat(subtotal) || computedSubtotal;
      const finalDelivery = parseFloat(delivery) || 0;
      const finalDiscount = parseFloat(discount) || 0;
      const finalTotal = parseFloat(total) || Math.max(0, finalSubtotal + finalDelivery - finalDiscount);
      const finalQtyOfGoods = normalizedItems.reduce((sum, item) => sum + item.qty, 0);
      const goodsDescription = normalizedItems.map(item => `${item.qty} x ${item.name}`).join(', ');

      const existing = await db.queryRows('SELECT id FROM online_orders WHERE id = ?', [id]);
      if (existing.length === 0) throw new Error('Order not found');

      await db.exec(
        `UPDATE online_orders SET
         customer_name = ?, customer_phone = ?, customer_address = ?, city = ?,
         items_json = ?, subtotal = ?, delivery = ?, discount = ?, total = ?,
         payment_status = ?, order_status = ?, notes = ?, weight = ?, qty_of_goods = ?, goods_description = ?
         WHERE id = ?`,
        [
          customer?.name || '',
          customer?.phone || '',
          customer?.address || '',
          city || customer?.city || '',
          JSON.stringify(normalizedItems),
          finalSubtotal,
          finalDelivery,
          finalDiscount,
          finalTotal,
          paymentStatus || 'cod',
          orderStatus || 'pending',
          notes || '',
          parseFloat(weight) || 0,
          finalQtyOfGoods,
          goodsDescription,
          id
        ]
      );

      return { success: true, id };
    } catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('db:onlineOrder:delete', async (event, orderId) => {
    try {
      requireAdmin('Deleting online orders');
      await db.exec('DELETE FROM online_orders WHERE id = ?', [orderId]);
      return { success: true };
    } catch (error) { console.error(error); throw error; }
  });

  // ── BULK UPDATE ORDER STATUS ───────────────────────────────────────
  // Updates multiple orders in a single transaction with rollback on failure
  ipcMain.handle('db:onlineOrder:bulkUpdateStatus', async (event, orderIds, status) => {
    try {
      requirePermission('db:onlineOrder:bulkUpdateStatus');
      const valid = ['pending', 'shipping', 'delivered', 'return'];
      if (!valid.includes(status)) throw new Error('Invalid status: ' + status);
      if (!Array.isArray(orderIds) || orderIds.length === 0) throw new Error('No order IDs provided');

      return await db.runTransaction(async (tx) => {
        let updatedCount = 0;
        let skippedCount = 0;

        for (const orderId of orderIds) {
          // Check if order exists and get current status
          const existing = await tx.queryRows('SELECT order_status FROM online_orders WHERE id = ?', [orderId]);
          if (existing.length === 0) continue; // Skip if not found

          const currentStatus = existing[0]?.order_status || 'pending';
          
          // Skip if already in target status
          if (currentStatus === status) {
            skippedCount++;
            continue;
          }

          // Update the order status
          await tx.exec('UPDATE online_orders SET order_status = ? WHERE id = ?', [status, orderId]);
          updatedCount++;
        }

        return { success: true, updated: updatedCount, skipped: skippedCount };
      });
    } catch (error) {
      console.error('Bulk update status error:', error);
      throw error;
    }
  });

  // ── FULL COMBINED REPORT ───────────────────────────────────────────
  // FIXED: Only count DELIVERED online orders for Grand Total Pieces
  // FIXED: Calculate Return Pieces from actual return records
  ipcMain.handle('db:report:getFullReport', async (event, startDate, endDate) => {
    try {
      requirePermission('db:report:getFullReport');
      const sales = await db.queryRows("SELECT * FROM sales WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at DESC", [startDate, endDate]);
      const adjustments = await require('./backend/adjustment-reports').report(db, startDate, endDate);
      const normalSales = sales.filter(s => String(s.notes || '').toUpperCase() !== 'WHOLESALE');
      const wholesaleSales = sales.filter(s => String(s.notes || '').toUpperCase() === 'WHOLESALE');
      let saleItems = [];
      if (normalSales.length > 0) {
        const ids = normalSales.map(s => `'${s.id}'`).join(',');
        saleItems = await db.queryRows(`SELECT * FROM sale_items WHERE sale_id IN (${ids})`);
      }
      let wholesaleSaleItems = [];
      if (wholesaleSales.length > 0) {
        const ids = wholesaleSales.map(s => `'${s.id}'`).join(',');
        wholesaleSaleItems = await db.queryRows(`SELECT * FROM sale_items WHERE sale_id IN (${ids})`);
      }

      // Get ALL online orders for the date range
      const onlineOrdersRaw = await db.queryRows("SELECT * FROM online_orders WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at DESC", [startDate, endDate]);
      
      // Only count DELIVERED orders for Grand Total Pieces
      const deliveredOnlineOrders = onlineOrdersRaw.filter(o => {
        const status = String(o.order_status || '').toLowerCase().trim();
        return status === 'delivered';
      });
      
      // Get shipping orders (for revenue calculation)
      const shippingOrders = onlineOrdersRaw.filter(o => {
        const status = String(o.order_status || '').toLowerCase().trim();
        return status === 'shipping' || status === 'shipped';
      });
      
      // Get return orders (for return count)
      const returnOrders = onlineOrdersRaw.filter(o => {
        const status = String(o.order_status || '').toLowerCase().trim();
        return status === 'return';
      });
      
      // Parse items for delivered orders
      const deliveredParsed = deliveredOnlineOrders.map(r => ({ ...r, items: r.items_json ? JSON.parse(r.items_json) : [] }));
      
      // Calculate Grand Total Pieces from DELIVERED orders only
      const grandTotalPieces = deliveredParsed.reduce((sum, o) => {
        const items = o.items || [];
        return sum + items.reduce((s, i) => s + (parseInt(i.qty) || 0), 0);
      }, 0);
      
      // Calculate Return Pieces from actual return records in returns table
      const returnRecords = await db.queryRows("SELECT * FROM returns WHERE invoice_type = 'online' AND date(created_at) BETWEEN ? AND ?", [startDate, endDate]);
      const returnPiecesFromReturns = returnRecords.reduce((sum, r) => sum + (parseInt(r.return_qty) || 0), 0);
      
      // Calculate Return Amount from simple online returns table
      const simpleReturnRecords = await db.queryRows("SELECT * FROM online_returns WHERE date(created_at) BETWEEN ? AND ?", [startDate, endDate]);
      const simpleReturnAmount = simpleReturnRecords.reduce((sum, r) => sum + (parseFloat(r.return_amount) || 0), 0);
      const simpleReturnPieces = simpleReturnRecords.reduce((sum, r) => sum + (parseInt(r.return_pieces) || 0), 0);
      
      // Total return pieces = returns table + simple online returns table
      const returnPieces = returnPiecesFromReturns + simpleReturnPieces;
      
       // Calculate Total Pieces (Net)
       const totalPieces = grandTotalPieces - returnPieces;
       
       // All visible online orders (shipping + delivered + return) for display
       const visibleOnlineOrders = [...shippingOrders, ...deliveredOnlineOrders, ...returnOrders];
       const onlineParsed = visibleOnlineOrders.map(r => ({ ...r, items: r.items_json ? JSON.parse(r.items_json) : [] }));
       
       const offlineRevenue  = normalSales.reduce((s, r) => s + (r.total    || 0), 0);
       const offlineDiscount = normalSales.reduce((s, r) => s + (r.discount || 0), 0);
       const offlineItems    = saleItems.reduce((s, i) => s + (i.qty  || 0), 0);
       const wholesaleRevenue = wholesaleSales.reduce((s, r) => s + (r.total || 0), 0);
       const wholesaleDiscount = wholesaleSales.reduce((s, r) => s + (r.discount || 0), 0);
       const wholesaleItems = wholesaleSaleItems.reduce((s, i) => s + (i.qty || 0), 0);
       
       // Online revenue: DELIVERED orders only (per task requirements)
       const onlineRevenue   = deliveredOnlineOrders.reduce((s, o) => s + (o.total || 0), 0);
       const onlineDiscount  = deliveredOnlineOrders.reduce((s, o) => s + (o.discount || 0), 0);
       
       // Calculate Net Online Revenue (Gross - Total Online Return Amount)
       const totalOnlineReturnAmount = simpleReturnRecords.reduce((sum, r) => sum + (parseFloat(r.return_amount) || 0), 0);
       const netOnlineRevenue = onlineRevenue - totalOnlineReturnAmount;
      
      const cityMap = {};
      onlineParsed.forEach(o => {
        const city = o.city || 'Unknown';
        if (!cityMap[city]) cityMap[city] = { orders: 0, revenue: 0, returned: 0, returnedRevenue: 0, delivered: 0 };
        cityMap[city].orders++;
        if (o.order_status === 'return') {
          cityMap[city].returned++;
          cityMap[city].returnedRevenue += o.total || 0;
        }
        if (o.order_status === 'shipping' || o.order_status === 'delivered') {
          cityMap[city].revenue += o.total || 0;
        }
        if (o.order_status === 'delivered') {
          cityMap[city].delivered++;
        }
      });
      const productMap = {};
      saleItems.forEach(item => {
        if (!productMap[item.product_code]) productMap[item.product_code] = { code: item.product_code, name: item.product_name, qty: 0, revenue: 0 };
        productMap[item.product_code].qty     += item.qty;
        productMap[item.product_code].revenue += item.subtotal;
      });
      const wholesaleProductMap = {};
      wholesaleSaleItems.forEach(item => {
        if (!wholesaleProductMap[item.product_code]) wholesaleProductMap[item.product_code] = { code: item.product_code, name: item.product_name, qty: 0, revenue: 0 };
        wholesaleProductMap[item.product_code].qty += item.qty;
        wholesaleProductMap[item.product_code].revenue += item.subtotal;
      });
       return {
         adjustments,
         period: { startDate, endDate },
         offline: { sales: normalSales, saleItems, summary: { totalSales: normalSales.length, totalRevenue: offlineRevenue, totalDiscount: offlineDiscount, totalItems: offlineItems }, productBreakdown: Object.values(productMap).sort((a,b) => b.revenue - a.revenue) },
         wholesale: { sales: wholesaleSales, summary: { totalSales: wholesaleSales.length, totalRevenue: wholesaleRevenue, totalDiscount: wholesaleDiscount, totalItems: wholesaleItems }, productBreakdown: Object.values(wholesaleProductMap).sort((a,b) => b.revenue - a.revenue) },
         online:  {
            simpleReturns: simpleReturnRecords,
            orders: onlineParsed,
           summary: {
             totalOrders: onlineParsed.length,
             totalRevenue: onlineRevenue,
             totalDiscount: onlineDiscount,
             netOnlineRevenue: netOnlineRevenue,
             returnedAmount: returnOrders.reduce((s, o) => s + (o.total || 0), 0),
             paid: onlineParsed.filter(o => o.payment_status === 'paid').length,
             cod: onlineParsed.filter(o => o.payment_status !== 'paid').length,
             returned: returnOrders.length,
             shipping: shippingOrders.length,
             delivered: deliveredOnlineOrders.length,
             grandTotalPieces: grandTotalPieces,
             returnPieces: returnPieces,
             totalPieces: totalPieces
           },
           cityBreakdown: Object.entries(cityMap).map(([city, d]) => ({ city, ...d })).sort((a, b) => b.orders - a.orders)
         },
         combined: { grossRevenue: offlineRevenue + wholesaleRevenue + netOnlineRevenue, netRevenue: offlineRevenue + wholesaleRevenue + netOnlineRevenue + adjustments.summary.netAdjustment, totalRevenue: offlineRevenue + wholesaleRevenue + netOnlineRevenue, totalDiscount: offlineDiscount + onlineDiscount, totalTransactions: sales.length + onlineParsed.length }
       };
    } catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('db:report:getUserPerformance', async (event, startDate, endDate) => {
    try {
      requirePermission('db:report:getUserPerformance');
      const logs = await db.queryRows(
        `SELECT l.*, o.customer_name, o.city, o.order_status, o.created_at AS order_date
         FROM user_performance_log l
         LEFT JOIN online_orders o ON l.order_id = o.id
         WHERE date(l.created_at) BETWEEN ? AND ?
         ORDER BY l.username, l.created_at`,
        [startDate, endDate]
      );
      const userMap = {};
      logs.forEach(log => {
        const u = log.username;
        if (!userMap[u]) {
          userMap[u] = {
            username: u,
            user_id: log.user_id,
            deliveredOrders: 0,
            deliveredSales: 0,
            deliveredPieces: 0,
            returnedOrders: 0,
            returnedAmount: 0,
            orders: [],
          };
        }
        if (log.is_return) {
          userMap[u].returnedOrders++;
          userMap[u].returnedAmount += log.amount || 0;
        } else if (log.order_status === 'shipping') {
          userMap[u].deliveredOrders++;
          userMap[u].deliveredPieces += log.pieces || 0;
          userMap[u].deliveredSales += log.amount || 0;
          userMap[u].orders.push({
            orderId: log.order_id,
            customer: log.customer_name || '—',
            city: log.city || '—',
            date: log.order_date || log.created_at,
            amount: log.amount || 0,
          });
        }
      });
      const users = Object.values(userMap)
        .map(u => ({ ...u, netSales: u.deliveredSales - u.returnedAmount }))
        .filter(u => u.deliveredOrders > 0 || u.returnedOrders > 0)
        .sort((a, b) => b.netSales - a.netSales);
      return { users, period: { startDate, endDate } };
    } catch (error) { console.error(error); throw error; }
  });

  // ════════════════════════════════════════════════════════════════════
  // ── RETURNS IPC ──────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:return:process', async (event, returnData) => { requirePermission('db:return:process'); return require('./backend/adjustments').processAdjustment(db, returnData, requireAuth('Processing returns'), 'return'); });

  // This handler processes simple online returns with just total pieces and amount
  // No invoice/order linking required - pure manual return entry
  ipcMain.handle('db:simpleOnlineReturn:process', async (event, returnData) => {
    try {
      requirePermission('db:simpleOnlineReturn:process');
      console.log('=== PROCESSING SIMPLE ONLINE RETURN (NO ORDER) ===', JSON.stringify(returnData));
      
      const { returnAmount, returnPieces, description, user } = returnData;
      
      // Validation
      if (returnAmount <= 0) throw new Error('Return amount must be greater than 0');
      if (returnPieces <= 0) throw new Error('Return pieces must be greater than 0');
      
      const authUser = requireAuth('Processing simple online returns');
      const userId = (user && user.id) || authUser.id || 0;
      const username = (user && user.username) || authUser.username || 'system';
      
      return await db.runTransaction(async (tx) => {
        // Check for duplicate within 5 minutes
        const recentCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const duplicateCheck = await tx.queryRows(
          'SELECT id FROM online_returns WHERE return_amount = ? AND return_pieces = ? AND created_at >= ?',
          [returnAmount, returnPieces, recentCutoff]
        );
        if (duplicateCheck.length > 0) {
          throw new Error('Duplicate return detected. This return was already processed.');
        }
        
        // Insert return record into online_returns table
        const returnInsert = await tx.exec(
          `INSERT INTO online_returns (return_amount, return_pieces, description, user_id, username, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            returnAmount,
            returnPieces,
            description || '',
            userId,
            username,
            new Date().toISOString()
          ]
        );
        
        // Add to user performance log
        await tx.exec(
          `INSERT INTO user_performance_log (user_id, username, order_id, order_type, pieces, amount, is_return, created_at)
           VALUES (?, ?, ?, 'online', ?, ?, 1, ?)`,
          [userId, username, 'SIMPLE_RETURN', returnPieces, returnAmount, new Date().toISOString()]
        );
        
        return { success: true, returnId: returnInsert.lastID, returnAmount, returnPieces };
      });
    } catch (error) {
      console.error('Simple online return processing error:', error);
      throw error;
    }
  });

  // Get list of simple online returns
  ipcMain.handle('db:simpleOnlineReturn:getList', async () => {
    try {
      requirePermission('db:simpleOnlineReturn:getList');
      return await db.queryRows('SELECT * FROM online_returns ORDER BY created_at DESC LIMIT 100') || [];
    } catch (error) {
      console.error('Get simple online returns list error:', error);
      return [];
    }
  });

  ipcMain.handle('db:return:getList', async () => {
    try {
      requirePermission('db:return:getList');
      return (await db.queryRows('SELECT * FROM returns ORDER BY created_at DESC LIMIT 100')).map(r => ({...r, receipt:require('./backend/adjustment-reports').receipt(r,'return')}));
    } catch (error) { console.error('Get returns list error:', error); return []; }
  });

  ipcMain.handle('db:return:getInvoice', async (event, invoiceId) => { try { requirePermission('db:return:getInvoice'); } catch (error) { requirePermission('exchange:invoice:lookup'); } try { return { success:true, data:await require('./backend/adjustments').lookup(db, invoiceId) }; } catch(e) { return { success:false, message:e.message }; } });

  // ════════════════════════════════════════════════════════════════════
  // ── EXCHANGES IPC ────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:exchange:process', async (event, data) => { requirePermission('db:exchange:process'); return require('./backend/adjustments').processAdjustment(db, data, requireAuth('Processing exchanges'), 'exchange'); });

  ipcMain.handle('db:exchange:getList', async () => {
    try {
      requirePermission('db:exchange:getList');
      return (await db.queryRows('SELECT * FROM exchanges ORDER BY created_at DESC LIMIT 100')).map(r => ({...r, receipt:require('./backend/adjustment-reports').receipt(r,'exchange')}));
    } catch (error) { console.error('Get exchanges list error:', error); return []; }
  });

  // ════════════════════════════════════════════════════════════════════
  // ── AUDIT LOG IPC ────────────────────────────────────────────────
  // ════════════════════════════════════════════════════════════════════

  ipcMain.handle('db:audit:log', async (event, entry) => {
    try {
      const payload = entry || {};
      await db.exec(
        `INSERT INTO audit_log (timestamp, user_id, username, user_role, system_type, action, invoice_number, customer_name, details, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [payload.timestamp || new Date().toISOString(), payload.userId || payload.user_id || null, payload.username || currentUser?.username || 'system', payload.userRole || currentUser?.role || 'cashier', payload.systemType || 'Offline', payload.action || 'Unknown', payload.invoiceNumber || payload.invoice_number || null, payload.customerName || payload.customer_name || null, payload.details || '', new Date().toISOString()]
      );
      return { success: true };
    } catch (error) { console.error('Audit log error:', error); throw error; }
  });

  ipcMain.handle('db:audit:getLogs', async (event, filters = {}) => {
    try {
      requirePermission('db:audit:getLogs');
      let sql = 'SELECT * FROM audit_log';
      const params = [], where = [];
      if (filters.startDate)  { where.push("date(created_at) >= ?"); params.push(filters.startDate);  }
      if (filters.endDate)    { where.push("date(created_at) <= ?"); params.push(filters.endDate);    }
      if (filters.username)   { where.push('username LIKE ?');       params.push(`%${filters.username}%`); }
      if (filters.action)     { where.push('action LIKE ?');         params.push(`%${filters.action}%`);   }
      if (filters.systemType) { where.push('system_type = ?');       params.push(filters.systemType);  }
      if (where.length) sql += ' WHERE ' + where.join(' AND ');
      sql += ' ORDER BY created_at DESC LIMIT 500';
      return await db.queryRows(sql, params);
    } catch (error) { console.error('Get audit logs error:', error); return []; }
  });

  ipcMain.handle('db:audit:clearOld', async (event, days = 90) => {
    try {
      requirePermission('db:audit:clearOld');
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - Number(days || 90));
      await db.exec('DELETE FROM audit_log WHERE created_at < ?', [cutoff.toISOString()]);
      return { success: true };
    } catch (error) { console.error('Clear old audit logs error:', error); throw error; }
  });

  // ── DIALOGS ───────────────────────────────────────────────────────
  ipcMain.handle('dialog:showSave', async (event, options) => {
    try { return await dialog.showSaveDialog(mainWindow, options); }
    catch (error) { console.error(error); throw error; }
  });

  ipcMain.handle('dialog:showMessageBox', async (event, options) => {
    try { return await dialog.showMessageBox(mainWindow, options); }
    catch (error) { console.error(error); throw error; }
  });

  // ── BACKUP ────────────────────────────────────────────────────────
  ipcMain.handle('db:backup:create', async () => {
    try {
      requireAdmin('Creating backups');
      const backup = await backupService.createBackup();
      return { success: true, path: backup };
    } catch (error) { console.error(error); throw error; }
  });

  // ── SILENT RECEIPT PRINTING ───────────────────────────────────────
  function selectEpsonPrinter(printers) {
    const candidates = printers.filter(p => {
      const name = `${p.name || ''} ${p.displayName || ''}`.toLowerCase();
      return name.includes('epson') ||
        name.includes('tm-t20') ||
        name.includes('tm-t200') ||
        name.includes('tm-t88') ||
        name.includes('thermal') ||
        name.includes('receipt');
    });

    return candidates.find(p => {
      const name = `${p.name || ''} ${p.displayName || ''}`.toLowerCase();
      return name.includes('epson') && (name.includes('tm-t20') || name.includes('tm-t200'));
    }) || candidates.find(p => `${p.name || ''} ${p.displayName || ''}`.toLowerCase().includes('epson')) || candidates[0];
  }

  function loadReceiptHtml(printWindow, html) {
    return new Promise((resolve, reject) => {
      printWindow.webContents.once('did-finish-load', resolve);
      printWindow.webContents.once('did-fail-load', (_event, _code, description) => reject(new Error(description)));
      printWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    });
  }

  function printReceiptWindow(printWindow, deviceName) {
    return new Promise((resolve) => {
      printWindow.webContents.print({
        silent: true,
        deviceName,
        printBackground: true,
        color: false,
        margins: { marginType: 'none' },
        pageSize: { width: 80000, height: 327600 },
        dpi: { horizontal: 203, vertical: 203 }
      }, (success, errorType) => {
        resolve({ success, errorType });
      });
    });
  }

  ipcMain.handle('print:receipt-silent', async (_event, receiptHtml) => {
    let printWindow = null;
    try {
      if (!receiptHtml || typeof receiptHtml !== 'string') {
        return { success: false, errorType: 'missing-receipt-html' };
      }

      printWindow = new BrowserWindow({
        show: false,
        width: 320,
        height: 900,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          backgroundThrottling: false
        }
      });

      await loadReceiptHtml(printWindow, receiptHtml);

      const printers = await printWindow.webContents.getPrintersAsync();
      
      if (!printers || printers.length === 0) {
        console.warn('Silent print failed: No printers detected on this system.');
        return { success: false, errorType: 'no-printers-found' };
      }
      
      const epsonPrinter = selectEpsonPrinter(printers);
      
      if (!epsonPrinter) {
        console.warn('Silent print failed: Epson printer not found in system printer list.');
        return { success: false, errorType: 'epson-printer-not-found' };
      }
      
      console.log(`Sending silent print job to printer: ${epsonPrinter.name}`);

      const result = await printReceiptWindow(printWindow, epsonPrinter.name);
      if (!result.success) {
        console.error(`Silent print failed: ${result.errorType}`);
      } else {
        console.log('Silent print completed successfully.');
      }
      return result;
    } catch (error) {
      console.error('Error in print:receipt-silent IPC handler:', error);
      return { success: false, errorType: error.message };
    } finally {
      if (printWindow && !printWindow.isDestroyed()) {
        printWindow.close();
      }
    }
  });

  module.exports = { app, DB_PATH, BACKUP_DIR, LOGS_DIR };
