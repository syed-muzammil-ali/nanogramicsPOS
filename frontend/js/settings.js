/**
 * SETTINGS MODULE
 * Updated: Added designation, description, status, page permissions
 */

// All available pages in the POS
const ALL_PAGES = [
  { id: 'wholesale', icon: '', label: 'Wholesale' },
  { id: 'shop', icon: '', label: 'SHOP' },
  { id: 'sales',     icon: '', label: 'Sales POS'    },
  { id: 'inventory', icon: '', label: 'Inventory'     },
  { id: 'online',    icon: '', label: 'Online Orders' },
  { id: 'returns',   icon: '', label: 'Returns'       },
  { id: 'exchange',  icon: '', label: 'Exchange'      },
  { id: 'reports',   icon: '', label: 'Reports'       },
  { id: 'audit',     icon: '', label: 'Audit Log'     },
  { id: 'settings',  icon: '', label: 'Settings'      },
];

class SettingsManager {
  constructor() {
    this.listenersSetup = false;
    this.isInitialized  = false;
  }

  // ── INIT ─────────────────────────────────────────────────────
  async init() {
    if (!this.listenersSetup) {
      this.setupEventListeners();
      this.listenersSetup = true;
      console.log('Settings: event listeners attached');
    }
    await this.loadUsers();
    this.isInitialized = true;
  }

  // ── EVENT LISTENERS ───────────────────────────────────────────
  setupEventListeners() {
    document.getElementById('btn-add-user')?.addEventListener('click', () => {
      this.openAddUserModal();
    });

    document.getElementById('btn-backup-db')?.addEventListener('click', () => {
      this.createBackup();
    });

    document.getElementById('user-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveUser();
    });

    // When role changes to admin — disable and check all permissions
    document.getElementById('user-role')?.addEventListener('change', (e) => {
      this.onRoleChange(e.target.value);
    });
  }

  // ── ROLE CHANGE HANDLER ───────────────────────────────────────
  onRoleChange(role) {
    const permSection = document.getElementById('permissions-section');
    const allCheckboxes = document.querySelectorAll('.perm-checkbox');
    const statusSelect = document.getElementById('user-status');

    if (role === 'admin') {
      // Admin gets all permissions automatically — show note, disable checkboxes
      if (permSection) {
        permSection.querySelector('.perm-note').textContent =
          ' Admin has full access to all pages automatically.';
      }
      allCheckboxes.forEach(cb => {
        cb.checked  = true;
        cb.disabled = true;
      });
    } else {
      if (permSection) {
        permSection.querySelector('.perm-note').textContent =
          'Select which pages this user can access.';
      }
      allCheckboxes.forEach(cb => {
        cb.disabled = false;
      });
    }
  }

  // ── LOAD USER LIST ────────────────────────────────────────────
  async loadUsers() {
    const listEl = document.getElementById('users-list');
    if (!listEl) return;

    listEl.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:10px 0;"> Loading users...</div>`;

    try {
      const users = await API.getUsers();
      if (!users || users.length === 0) {
        listEl.innerHTML = `<div style="color:var(--muted);font-size:13px;padding:10px 0;">No users found.</div>`;
        return;
      }

      listEl.innerHTML = `
        <div style="overflow-x:auto;background:var(--panel2);border-radius:12px;border:1px solid var(--border);padding:4px;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="border-bottom:2px solid var(--border);">
                <th style="padding:10px 12px;text-align:left;color:var(--muted);font-size:11px;">#</th>
                <th style="padding:10px 12px;text-align:left;color:var(--muted);font-size:11px;">Username</th>
                <th style="padding:10px 12px;text-align:left;color:var(--muted);font-size:11px;">Role</th>
                <th style="padding:10px 12px;text-align:left;color:var(--muted);font-size:11px;">Designation</th>
                <th style="padding:10px 12px;text-align:left;color:var(--muted);font-size:11px;">Pages</th>
                <th style="padding:10px 12px;text-align:center;color:var(--muted);font-size:11px;">Status</th>
                <th style="padding:10px 12px;text-align:left;color:var(--muted);font-size:11px;">Created</th>
                <th style="padding:10px 12px;text-align:center;color:var(--muted);font-size:11px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${users.map((u, i) => this.renderUserRow(u, i + 1)).join('')}
            </tbody>
          </table>
        </div>`;
    } catch (error) {
      console.error('Load users error:', error);
      listEl.innerHTML = `<div style="color:#ef4444;font-size:13px;padding:10px 0;"> Failed to load users: ${error.message}</div>`;
    }
  }

  renderUserRow(u, num) {
    const isAdmin = u.role === 'admin';
    const roleStyle = isAdmin
      ? 'background:#1a0a2e;color:#c084fc;'
      : 'background:#0a1a2e;color:#60a5fa;';

    const statusStyle = u.status === 'active'
      ? 'background:#0d2e1a;color:#10b981;'
      : 'background:#2e0f0f;color:#f87171;';

    let permissions = [];
    try { permissions = JSON.parse(u.permissions || '[]'); } catch(e) { permissions = []; }

    const pagesDisplay = isAdmin
      ? '<span style="color:#c084fc;font-size:10px;font-weight:700;">ALL PAGES</span>'
      : permissions.length > 0
        ? `<span style="font-size:10px;color:var(--muted);">${permissions.length} page${permissions.length !== 1 ? 's' : ''}</span>`
        : '<span style="font-size:10px;color:#6b7280;">Legacy (all)</span>';

    // Escape username for safe inline JS
    const safeUsername = u.username.replace(/'/g, "\\'");
    const safeDesig    = (u.designation || '').replace(/'/g, "\\'");

    return `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px 12px;color:var(--muted);font-size:11px;">${num}</td>
        <td style="padding:8px 12px;font-weight:700;color:var(--yellow);">${u.username}</td>
        <td style="padding:8px 12px;">
          <span style="padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700;${roleStyle}">${u.role}</span>
        </td>
        <td style="padding:8px 12px;font-size:12px;color:#e5e7eb;">${u.designation || '—'}</td>
        <td style="padding:8px 12px;">${pagesDisplay}</td>
        <td style="padding:8px 12px;text-align:center;">
          <span style="padding:3px 10px;border-radius:10px;font-size:10px;font-weight:700;${statusStyle}">
            ${u.status === 'active' ? '✓ Active' : '✗ Inactive'}
          </span>
        </td>
        <td style="padding:8px 12px;color:var(--muted);font-size:11px;">${formatDate(u.created_at)}</td>
        <td style="padding:8px 12px;text-align:center;">
          <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
            <button
              onclick="settingsManager.openEditUserModal(${u.id}, '${safeUsername}', '${u.role}', '${safeDesig}', ${JSON.stringify(u.description || '')}, ${JSON.stringify(u.permissions || '[]')}, '${u.status || 'active'}')"
              style="padding:5px 12px;border-radius:6px;border:none;background:#1a1e2a;color:#60a5fa;cursor:pointer;font-size:11px;font-weight:600;font-family:'Outfit',sans-serif;">
               Edit
            </button>
            <button
              onclick="settingsManager.deleteUser(${u.id}, '${safeUsername}')"
              style="padding:5px 12px;border-radius:6px;border:none;background:#2e0f0f;color:#f87171;cursor:pointer;font-size:11px;font-weight:600;font-family:'Outfit',sans-serif;">
               Delete
            </button>
          </div>
        </td>
      </tr>`;
  }

  // ── OPEN ADD USER MODAL ───────────────────────────────────────
  openAddUserModal() {
    document.getElementById('modal-user-title').textContent = 'Add New User';
    document.getElementById('user-id').value          = '';
    document.getElementById('user-username').value    = '';
    document.getElementById('user-username').disabled = false;
    document.getElementById('user-password').value    = '';
    document.getElementById('user-password').placeholder = 'Min 6 characters (required)';
    document.getElementById('user-role').value        = 'cashier';
    document.getElementById('user-designation').value = '';
    document.getElementById('user-description').value = '';
    document.getElementById('user-status').value      = 'active';

    // Uncheck all permission checkboxes and enable them
    document.querySelectorAll('.perm-checkbox').forEach(cb => {
      cb.checked  = false;
      cb.disabled = false;
    });
    document.querySelector('.perm-note').textContent = 'Select which pages this user can access.';

    showModal('modal-user-form');
    setTimeout(() => document.getElementById('user-username').focus(), 100);
  }

  // ── OPEN EDIT USER MODAL ──────────────────────────────────────
  openEditUserModal(userId, username, role, designation, description, permissionsJson, status) {
    document.getElementById('modal-user-title').textContent = 'Edit User';
    document.getElementById('user-id').value          = userId;
    document.getElementById('user-username').value    = username;
    document.getElementById('user-username').disabled = true;
    document.getElementById('user-password').value    = '';
    document.getElementById('user-password').placeholder = 'Leave blank to keep current password';
    document.getElementById('user-role').value        = role;
    document.getElementById('user-designation').value = designation || '';
    document.getElementById('user-description').value = description || '';
    document.getElementById('user-status').value      = status || 'active';

    // Parse and set permission checkboxes
    let permissions = [];
    try { permissions = JSON.parse(permissionsJson || '[]'); } catch(e) { permissions = []; }

    if (role === 'admin') {
      document.querySelectorAll('.perm-checkbox').forEach(cb => { cb.checked = true; cb.disabled = true; });
      document.querySelector('.perm-note').textContent = ' Admin has full access to all pages automatically.';
    } else {
      document.querySelectorAll('.perm-checkbox').forEach(cb => {
        cb.checked  = permissions.includes(cb.value);
        cb.disabled = false;
      });
      document.querySelector('.perm-note').textContent = 'Select which pages this user can access.';
    }

    showModal('modal-user-form');
  }

  // ── COLLECT PERMISSIONS FROM CHECKBOXES ───────────────────────
  collectPermissions() {
    const role = document.getElementById('user-role').value;
    if (role === 'admin') {
      // Admin gets all permissions
      return ALL_PAGES.map(p => p.id);
    }
    const checked = [];
    document.querySelectorAll('.perm-checkbox:checked').forEach(cb => checked.push(cb.value));
    return checked;
  }

  // ── SAVE USER ─────────────────────────────────────────────────
  async saveUser() {
    const userId      = document.getElementById('user-id').value;
    const username    = document.getElementById('user-username').value.trim();
    const password    = document.getElementById('user-password').value;
    const role        = document.getElementById('user-role').value;
    const designation = document.getElementById('user-designation').value.trim();
    const description = document.getElementById('user-description').value.trim();
    const status      = document.getElementById('user-status').value;
    const permissions = this.collectPermissions();

    if (!username) { showToast('Username is required', 'error'); return; }

    try {
      if (userId) {
        // ── EDIT ──
        const updates = { role, designation, description, permissions: JSON.stringify(permissions), status };
        if (password) {
          if (password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
          updates.password = password;
        }
        await API.updateUser(parseInt(userId), updates);
        showToast(`User "${username}" updated successfully`, 'success');
        await API.logAuditEntry({
          action: 'User Edited',
          details: `User "${username}" updated — role: "${role}", designation: "${designation}", status: "${status}", pages: ${permissions.length}`,
          username: auth?.getCurrentUser?.()?.username || 'admin',
          userRole: auth?.getCurrentUser?.()?.role    || 'admin',
          systemType: 'Offline'
        });
      } else {
        // ── ADD ──
        if (!password || password.length < 6) { showToast('Password must be at least 6 characters', 'error'); return; }
        await API.addUser({ username, password, role, designation, description, permissions: JSON.stringify(permissions), status });
        showToast(`User "${username}" created successfully`, 'success');
        await API.logAuditEntry({
          action: 'User Created',
          details: `New user "${username}" created — role: "${role}", designation: "${designation}", pages: ${permissions.length}`,
          username: auth?.getCurrentUser?.()?.username || 'admin',
          userRole: auth?.getCurrentUser?.()?.role    || 'admin',
          systemType: 'Offline'
        });
      }

      hideModal('modal-user-form');
      await this.loadUsers();
    } catch (error) {
      console.error('Save user error:', error);
      showToast(error.message, 'error');
    }
  }

  // ── DELETE USER ───────────────────────────────────────────────
  async deleteUser(userId, username) {
    const confirmed = await showConfirm('Delete User', `Delete user "${username}"?\n\nThis cannot be undone.`);
    if (!confirmed) return;
    try {
      await API.deleteUser(userId);
      showToast(`User "${username}" deleted`, 'success');
      await API.logAuditEntry({
        action: 'User Deleted',
        details: `User "${username}" permanently deleted`,
        username: auth?.getCurrentUser?.()?.username || 'admin',
        userRole: auth?.getCurrentUser?.()?.role    || 'admin',
        systemType: 'Offline'
      });
      await this.loadUsers();
    } catch (error) {
      console.error('Delete user error:', error);
      showToast(error.message, 'error');
    }
  }

  // ── CREATE BACKUP ─────────────────────────────────────────────
  async createBackup() {
    try {
      showToast('Creating backup...', 'info');
      const result = await API.createBackup();
      showToast('Backup created successfully!', 'success');
      await API.showMessageBox({
        type: 'info', title: 'Backup Created',
        message: 'Database backup saved successfully.',
        detail: `Location: ${result.path || 'Backup folder'}`
      });
      await API.logAuditEntry({
        action: 'Backup Created', details: 'Manual database backup created',
        username: auth?.getCurrentUser?.()?.username || 'admin',
        userRole: auth?.getCurrentUser?.()?.role    || 'admin',
        systemType: 'Offline'
      });
    } catch (error) {
      console.error('Backup error:', error);
      showToast('Backup failed: ' + error.message, 'error');
    }
  }
}

const settingsManager = new SettingsManager();
window.settingsManager = settingsManager;
console.log('Settings module loaded');
