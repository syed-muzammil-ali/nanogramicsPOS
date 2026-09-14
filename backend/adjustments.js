const { randomUUID } = require('crypto');
const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const parse = s => JSON.parse(s || '[]');
async function lookup(tx, id, type) {
  id = String(id || '').trim();
  for (const kind of type ? [type] : ['offline', 'online']) {
    if (!['offline', 'online'].includes(kind)) throw Error('Invalid invoice type');
    const [sale] = await tx.queryRows(`SELECT * FROM ${kind === 'online' ? 'online_orders' : 'sales'} WHERE id = ?`, [id]);
    if (!sale) continue;
    const raw = kind === 'online' ? parse(sale.items_json) : await tx.queryRows('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', [id]);
    const used = new Map();
    const records = await tx.queryRows('SELECT items_json AS items FROM returns WHERE invoice_id = ? AND invoice_type = ? UNION ALL SELECT original_items AS items FROM exchanges WHERE original_invoice_id = ? AND invoice_type = ?', [id, kind, id, kind]);
    for (const row of records) parse(row.items).forEach((i, index) => { const key = Number(i.itemIndex ?? index); used.set(key, (used.get(key) || 0) + Number(i.qty)); });
    const gross = raw.reduce((s, i) => s + Number(i.price) * Number(i.qty), 0);
    const net = Math.max(0, gross - Number(sale.discount || 0));
    const items = raw.map((i, itemIndex) => ({ ...i, itemIndex, code: i.code || i.product_code || '', name: i.name || i.product_name || '', qty: Number(i.qty), price: Number(i.price), refundPrice: gross ? net * Number(i.price) / gross : 0, available: Math.max(0, Number(i.qty) - (used.get(itemIndex) || 0)) }));
    return { ...sale, invoiceType: kind, isOnline: kind === 'online', items, remainingAmount: money(items.reduce((s, i) => s + i.available * i.refundPrice, 0)) };
  }
  throw Error('Invoice not found');
}
async function processAdjustment(db, data, user, mode) {
  return db.runTransaction(async tx => {
    const invoice = await lookup(tx, data.invoiceId || data.originalInvoiceId, data.invoiceType);
    if (invoice.order_status === 'return' && !parse(invoice.returned_items).length) throw Error('This order has already been returned');
    const selected = data.items;
    if (!Array.isArray(selected) || !selected.length) throw Error('Select products to return or exchange');
    const seen = new Set();
    const items = selected.map(s => {
      const item = invoice.items[s.itemIndex];
      if (!item || seen.has(s.itemIndex) || !Number.isInteger(s.qty) || s.qty < 1 || s.qty > item.available) throw Error('Invalid quantity or items already returned/exchanged');
      seen.add(s.itemIndex); return { ...item, qty: s.qty };
    });
    const credit = money(items.reduce((s, i) => s + i.qty * i.refundPrice, 0));
    const replacements = [];
    for (const item of items) if (item.code) await tx.exec('UPDATE products SET qty = qty + ? WHERE code = ?', [item.qty, item.code]);
    if (mode === 'exchange') {
      if (!Array.isArray(data.newItems) || !data.newItems.length) throw Error('Select replacement products');
      for (const s of data.newItems) {
        const [p] = await tx.queryRows('SELECT * FROM products WHERE code = ?', [s.code]);
        if (!p || !Number.isInteger(s.qty) || s.qty < 1 || s.qty > Number(p.qty)) throw Error('Replacement product has insufficient stock');
        replacements.push({ code: p.code, name: p.name, price: Number(p.price), qty: s.qty });
        await tx.exec('UPDATE products SET qty = qty - ? WHERE code = ?', [s.qty, p.code]);
      }
    }
    const newAmount = money(replacements.reduce((s, i) => s + i.qty * i.price, 0));
    const refundAmount = money(Math.max(0, credit - newAmount)), additionalAmount = money(Math.max(0, newAmount - credit));
    const now = new Date().toISOString(), qty = items.reduce((s, i) => s + i.qty, 0);
    let invoiceNumber, recordId;
    if (mode === 'return') {
      const row = await tx.exec(`INSERT INTO returns (invoice_id, invoice_type, return_type, return_reason, return_qty, items_json, original_items, total_amount, refund_amount, user_id, username, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [invoice.id, invoice.invoiceType, qty === invoice.items.reduce((s,i)=>s+i.available,0) ? 'full' : 'partial', data.reason || '', qty, JSON.stringify(items), JSON.stringify(invoice.items), invoice.total, credit, user.id, user.username, now]);
      recordId = row.lastID;
      invoiceNumber = 'RET-' + String(row.lastID).padStart(6, '0');
    } else {
      invoiceNumber = 'EXC-' + randomUUID();
      await tx.exec(`INSERT INTO exchanges (exchange_number, original_invoice_id, invoice_type, original_items, new_items, new_qty_of_goods, original_amount, new_amount, additional_amount, refund_amount, reason, user_id, username, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [invoiceNumber, invoice.id, invoice.invoiceType, JSON.stringify(items), JSON.stringify(replacements), replacements.reduce((s,i)=>s+i.qty,0), credit, newAmount, additionalAmount, refundAmount, data.reason || '', user.id, user.username, now]);
    }
    const table = invoice.isOnline ? 'online_orders' : 'sales';
    const consumed = [...parse(invoice.returned_items), ...items.map(i => ({ itemIndex:i.itemIndex, qty:i.qty, date:now, invoiceNumber }))];
    const full = invoice.items.every(i => i.available === (items.find(s=>s.itemIndex===i.itemIndex)?.qty || 0));
    await tx.exec(`UPDATE ${table} SET returned_items = ?, return_status = ? WHERE id = ?`, [JSON.stringify(consumed), full ? 'returned' : 'partial', invoice.id]);
    if (mode === 'exchange') await tx.exec(`UPDATE ${table} SET exchange_status = 'exchanged' WHERE id = ?`, [invoice.id]);
    await tx.exec('INSERT INTO user_performance_log (user_id, username, order_id, order_type, pieces, amount, is_return, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', [user.id,user.username,invoiceNumber,invoice.invoiceType,qty,credit,now]);
    if (replacements.length) await tx.exec('INSERT INTO user_performance_log (user_id, username, order_id, order_type, pieces, amount, is_return, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)', [user.id,user.username,invoiceNumber,invoice.invoiceType,replacements.reduce((s,i)=>s+i.qty,0),newAmount,now]);
    await tx.exec('INSERT INTO audit_log (timestamp, user_id, username, user_role, system_type, action, invoice_number, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [now,user.id,user.username,user.role || 'cashier',invoice.invoiceType,mode === 'return' ? 'Return Invoice Created' : 'Exchange Invoice Created',invoiceNumber,JSON.stringify({originalInvoiceId:invoice.id,credit,newAmount,refundAmount,additionalAmount}),now]);
    const result = { success:true, invoiceType:invoice.invoiceType, reason:data.reason || '', invoiceNumber, originalInvoiceId:invoice.id, mode, items, newItems:replacements, credit, newAmount, refundAmount, additionalAmount, remainingAmount:money(invoice.remainingAmount-credit), created_at:now };
    if (mode === 'return') await tx.exec('UPDATE returns SET receipt_json = ? WHERE id = ?', [JSON.stringify(result),recordId]);
    else await tx.exec('UPDATE exchanges SET receipt_json = ? WHERE exchange_number = ?', [JSON.stringify(result),invoiceNumber]);
    return result;
  });
}
module.exports = { lookup, processAdjustment };
