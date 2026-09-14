/**
 * UI MODULE
 * Updated: Permission-based sidebar navigation + Access Denied enforcement
 */

// ── TOAST ─────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const safeMessage = String(message || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type || 'info'}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warning' ? '⚠' : 'ℹ'}</span>
    <span>${safeMessage}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity   = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => toast.remove(), 220);
  }, 2600);
}

// ── CONFIRM ───────────────────────────────────────────────────────
function showConfirm(title, message) {
  return new Promise((resolve) => { resolve(window.confirm(`${title}\n\n${message}`)); });
}

// ── GET USER PERMISSIONS ──────────────────────────────────────────
/**
 * Returns array of page IDs the current user can access.
 * Admins get all pages. Cashiers with no permissions get legacy set.
 */
function getUserPermissions() {
  const user    = auth.getCurrentUser();
  const isAdmin = auth.isAdmin();

  if (isAdmin) {
    // Admin sees everything
    return ['sales', 'inventory', 'shop', 'wholesale', 'online', 'returns', 'exchange', 'reports', 'audit', 'settings'];
  }

  let permissions = [];
  try { permissions = JSON.parse(user.permissions || '[]'); } catch(e) { permissions = []; }

  // Legacy behavior: cashier with no permissions gets basic tabs
  if (permissions.length === 0) {
    return ['sales', 'inventory', 'shop', 'wholesale', 'online', 'returns', 'exchange'];
  }

  return permissions;
}

// ── INIT UI ───────────────────────────────────────────────────────
function initializeUI() {
  console.log('Initializing UI...');
  setupNavigation();
  setupModals();
  updateUserDisplay();
  updateDateTime();
  if (!window.posClockTimer) window.posClockTimer = setInterval(updateDateTime, 1000);

  // Navigate to first allowed page
  const allowedPages = getUserPermissions();
  switchTab(allowedPages[0] || 'sales');
}

// ── NAVIGATION ────────────────────────────────────────────────────
function setupNavigation() {
  const nav = document.getElementById('nav-menu');
  if (!nav) return;

  const allowedPages = getUserPermissions();

  const allTabs = [
    { id: 'sales',     icon: '💰', label: 'Point of sale'     },
    { id: 'inventory', icon: '📦', label: 'Inventory'     },
    { id: 'shop', icon: '🏪', label: 'Shop stock' },
    { id: 'wholesale', icon: '🏷️', label: 'Wholesale'     },
    { id: 'online',    icon: '🌐', label: 'Online Orders' },
    { id: 'returns',   icon: '🔄', label: 'Returns'       },
    { id: 'exchange',  icon: '🔁', label: 'Exchange'      },
    { id: 'reports',   icon: '📊', label: 'Reports'       },
    { id: 'audit',     icon: '📋', label: 'Audit Log'     },
    { id: 'settings',  icon: '⚙️', label: 'Settings'      },
  ];

  // Filter to only allowed pages
  const visibleTabs = allTabs.filter(tab => allowedPages.includes(tab.id));

  const navPaths = {"sales":"M3 3h18v14H3z M7 21h10 M12 17v4 M7 7h10 M7 11h4","inventory":"m12 3 9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9 M7 5l10 6","shop":"M3 10h18l-2-7H5z M5 10v11h14V10 M9 21v-7h6v7","wholesale":"M3 3h8l10 10-8 8L3 11z M7 7h.01","online":"M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18","returns":"M8 4 3 9l5 5 M3 9h11a7 7 0 0 1 0 14","exchange":"M3 7h18l-4-4 M21 17H3l4 4","reports":"M4 3v18h17 M8 17v-5 M13 17V7 M18 17V4","audit":"M8 4H5v17h14V4h-3 M8 3h8v4H8z M8 11h8 M8 15h6","settings":"M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2"};
  nav.innerHTML = visibleTabs.map(tab => `
    <button class="nav-button" data-tab="${tab.id}" title="${tab.label}" aria-label="${tab.label}">
      <span class="nav-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${navPaths[tab.id]}"/></svg></span>
      <span class="nav-label">${tab.label}</span>
    </button>`).join('');

  nav.querySelectorAll('.nav-button').forEach(btn => {
    btn.addEventListener('click', () => switchTabWithPermission(btn.dataset.tab));
  });

  // Set active on first visible tab
  if (visibleTabs.length > 0) {
    const firstBtn = document.querySelector(`.nav-button[data-tab="${visibleTabs[0].id}"]`);
    if (firstBtn) firstBtn.classList.add('active');
  }
}

// ── SWITCH TAB ────────────────────────────────────────────────────
function switchTabWithPermission(tabId) {
  const allowedPages = getUserPermissions();

  // Permission check
  if (!allowedPages.includes(tabId)) {
    showAccessDenied(tabId);
    return;
  }

  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(el => {
    el.style.display = 'none';
    el.classList.remove('active');
  });

  // Show target tab
  const target = document.getElementById(`tab-${tabId}`);
  if (target) {
    target.style.display = 'flex';
    target.classList.add('active');
  }

  // Update nav active state
  document.querySelectorAll('.nav-button').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
    if (btn.dataset.tab === tabId) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });

  // Update page title
  const titleMap = {
    shop: 'Shop stock',
    sales:     'Point of sale',
    inventory: 'Inventory',
    wholesale: 'Wholesale',
    reports:   'Sales reports',
    online:    'Online orders',
    returns:   'Returns',
    exchange:  'Exchanges',
    audit:     'Audit log',
    settings:  'Settings'
  };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titleMap[tabId] || tabId.toUpperCase();

  // ── Module-specific init ──────────────────────────────────────
  if (tabId === 'shop' && typeof shopManager !== 'undefined') shopManager.init();

  // Audit: always call init (internal guard prevents double-binding)
  if (tabId === 'audit' && typeof auditManager !== 'undefined') {
    setTimeout(() => auditManager.init(), 50);
  }

  // Settings: always refresh user list
  if (tabId === 'settings' && typeof settingsManager !== 'undefined') {
    setTimeout(() => settingsManager.init(), 50);
  }

  // Wholesale: initialize the wholesale module
  if (tabId === 'wholesale' && typeof wholesale !== 'undefined') {
    setTimeout(() => wholesale.init(), 50);
  }
}

// Alias for compatibility
function switchTab(tabId) {
  switchTabWithPermission(tabId);
}

// ── ACCESS DENIED ─────────────────────────────────────────────────
function showAccessDenied(tabId) {
  // Show in the tab area without navigating away
  const titleMap = {
    sales: 'Sales POS', inventory: 'Inventory', online: 'Online Orders',
    returns: 'Returns', exchange: 'Exchange', reports: 'Reports',
    audit: 'Audit Log', settings: 'Settings'
  };
  const pageName = titleMap[tabId] || tabId;

  // Insert or update an access denied overlay inside the current active tab
  let denied = document.getElementById('access-denied-overlay');
  if (!denied) {
    denied = document.createElement('div');
    denied.id = 'access-denied-overlay';
    denied.style.cssText = `
      position:fixed;top:0;left:0;right:0;bottom:0;
      background:rgba(0,0,0,0.7);z-index:500;
      display:flex;align-items:center;justify-content:center;
    `;
    document.body.appendChild(denied);
  }
  denied.innerHTML = `
    <div style="background:#13161f;border:1px solid #2d1515;border-radius:16px;padding:40px;text-align:center;max-width:400px;">
      <div style="font-size:52px;margin-bottom:12px;">🔒</div>
      <h3 style="color:#f87171;margin:0 0 10px;font-size:18px;">Access Denied</h3>
      <p style="color:#6b7280;font-size:13px;margin:0 0 20px;">
        You do not have permission to access <strong style="color:#e5e7eb;">${pageName}</strong>.
        Please contact your administrator.
      </p>
      <button onclick="document.getElementById('access-denied-overlay').remove();"
        style="padding:10px 24px;border-radius:10px;border:none;background:#f5c518;color:#000;
               font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif;font-size:13px;">
        OK
      </button>
    </div>`;
  denied.style.display = 'flex';
}

// ── USER DISPLAY ──────────────────────────────────────────────────
function updateUserDisplay() {
  const user = auth.getCurrentUser();
  const el   = document.getElementById('user-display');
  if (el) {
    if (user) {
      const desig = user.designation ? ` · ${user.designation}` : '';
      el.replaceChildren();
      const avatar = document.createElement('span');
      avatar.className = 'user-avatar';
      avatar.setAttribute('aria-hidden', 'true');
      avatar.textContent = String(user.username || 'U').slice(0, 1).toUpperCase();
      const details = document.createElement('span');
      details.className = 'user-details';
      details.textContent = user.username;
      const role = document.createElement('small');
      role.textContent = user.role + desig;
      details.append(role);
      el.append(avatar, details);
    } else {
      el.textContent = 'Not logged in';
    }
  }
}

// ── DATE / TIME ───────────────────────────────────────────────────
function updateDateTime() {
  const now    = new Date();
  const timeEl = document.getElementById('clock');
  const dateEl = document.getElementById('date-disp');
  if (timeEl) timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  if (dateEl) dateEl.textContent = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── MODALS ────────────────────────────────────────────────────────
function setupModals() {
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.modal');
      if (modal) hideModal(modal.id);
    });
  });
  document.getElementById('modal-overlay')?.addEventListener('click', () => {
    document.querySelectorAll('.modal').forEach(m => hideModal(m.id));
  });
}

function showModal(modalId) {
  const modal   = document.getElementById(modalId);
  const overlay = document.getElementById('modal-overlay');
  if (modal)   { modal.style.display = 'flex'; modal.style.animation = 'modalIn 0.2s ease'; }
  if (overlay) overlay.style.display = 'block';
}

function hideModal(modalId) {
  const modal   = document.getElementById(modalId);
  const overlay = document.getElementById('modal-overlay');
  if (modal)   modal.style.display   = 'none';
  if (overlay) overlay.style.display = 'none';
}

// ── GLOBAL EXPORTS ────────────────────────────────────────────────
window.showToast               = showToast;
window.showConfirm             = showConfirm;
window.showModal               = showModal;
window.hideModal               = hideModal;
window.switchTab               = switchTab;
window.switchTabWithPermission = switchTabWithPermission;
window.getUserPermissions      = getUserPermissions;
