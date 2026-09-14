/**
 * AUTHENTICATION MODULE (FRONTEND)
 *
 * Handles login/logout, session management, role-based access.
 */

class AuthManager {
  constructor() {
    this.currentUser = null;
    this.isAuthenticated = false;
    this.sessionTimeout = 60 * 60 * 1000; // 1 hour
    this.sessionTimer = null;
  }

  async init() {
    const stored = sessionStorage.getItem('auth_session');
    if (stored) {
      try {
        this.currentUser = JSON.parse(stored);
        this.isAuthenticated = true;
        this.startSessionTimer();
        return true;
      } catch {
        this.logout();
      }
    }
    return false;
  }

  async login(username, password) {
    try {
      if (!username || !username.trim()) {
        throw new Error('Please enter your username');
      }
      if (!password) {
        throw new Error('Please enter your password');
      }

      const user = await API.authenticate(username.trim(), password);

      if (!user || !user.username) {
        throw new Error('Login failed. Please try again.');
      }

      this.currentUser = user;
      this.isAuthenticated = true;

      sessionStorage.setItem('auth_session', JSON.stringify(user));
      this.startSessionTimer();

      // Log audit
      try {
        await API.logAuditEntry({
          action: 'Login',
          username: user.username,
          userRole: user.role,
          details: `User ${user.username} logged in`,
          systemType: 'Offline'
        });
      } catch (e) {
        console.warn('Audit log failed:', e);
      }

      console.log(`Logged in: ${user.username} (${user.role})`);
      return user;
    } catch (error) {
      console.error('Login failed:', error);
      throw new Error(error.message || 'Login failed. Please try again.');
    }
  }

  logout() {
    const user = this.currentUser;
    this.currentUser = null;
    this.isAuthenticated = false;
    sessionStorage.removeItem('auth_session');
    this.clearSessionTimer();

    try {
      API.logoutUser();
    } catch (e) {
      console.warn('Backend logout signal failed:', e);
    }

    // Log audit
    if (user) {
      try {
        API.logAuditEntry({
          action: 'Logout',
          username: user.username,
          userRole: user.role,
          details: `User ${user.username} logged out`,
          systemType: 'Offline'
        });
      } catch (e) {
        console.warn('Audit log failed:', e);
      }
    }
  }

  getCurrentUser() {
    return this.currentUser;
  }

  isLoggedIn() {
    return this.isAuthenticated && this.currentUser !== null;
  }

  hasRole(role) {
    return this.isLoggedIn() && this.currentUser.role === role;
  }

  isAdmin() {
    return this.hasRole('admin');
  }

  isCashier() {
    return this.hasRole('cashier');
  }

  // ── PERMISSION CHECKS ─────────────────────────────────────────

  canAccessReports() {
    return this.isLoggedIn() && this.isAdmin();
  }

  canAccessAuditLog() {
    return this.isLoggedIn() && this.isAdmin();
  }

  canAccessSettings() {
    return this.isLoggedIn() && this.isAdmin();
  }

  canManageUsers() {
    return this.isLoggedIn() && this.isAdmin();
  }

  canAccessReturns() {
    return this.isLoggedIn();
  }

  canAccessExchange() {
    return this.isLoggedIn();
  }

  canAccessInventory() {
    return this.isLoggedIn();
  }

  canEditInventory() {
    return this.isLoggedIn() && this.isAdmin();
  }

  canProcessReturn() {
    return this.isLoggedIn();
  }

  canProcessExchange() {
    return this.isLoggedIn();
  }

  canAccessOnlineOrders() {
    return this.isLoggedIn();
  }

  canAccessSales() {
    return this.isLoggedIn();
  }

  canPerformAction(action) {
    if (!this.isLoggedIn()) return false;
    const perms = {
      admin: ['sales', 'inventory', 'reports', 'settings', 'users', 'online', 'returns', 'exchange', 'audit'],
      cashier: ['sales', 'inventory', 'online', 'returns', 'exchange']
    };
    return (perms[this.currentUser.role] || []).includes(action);
  }

  startSessionTimer() {
    this.clearSessionTimer();
    this.sessionTimer = setTimeout(() => {
      showToast('Session expired. Please login again.', 'warning');
      this.logout();
      showLoginScreen();
    }, this.sessionTimeout);
  }

  resetSessionTimer() {
    if (this.isLoggedIn()) this.startSessionTimer();
  }

  clearSessionTimer() {
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
  }
}

// Create global instance
const auth = new AuthManager();

// ── DOM Helpers ─────────────────────────────────────────────────

function showLoginScreen() {
  const login = document.getElementById('login-screen');
  const main = document.getElementById('main-app');
  if (login) login.style.display = 'flex';
  if (main) main.style.display = 'none';
  const form = document.getElementById('login-form');
  if (form) {
    form.reset();
    const err = document.getElementById('login-error');
    if (err) err.textContent = '';
  }
}

function showMainApp() {
  const login = document.getElementById('login-screen');
  const main = document.getElementById('main-app');
  if (login) login.style.display = 'none';
  if (main) main.style.display = 'flex';
}

// ── Handlers ────────────────────────────────────────────────────

async function handleLoginSubmit(event) {
  event.preventDefault();
  event.stopPropagation();

  const form = event.currentTarget || event.target;
  if (form && typeof form.checkValidity === 'function' && !form.checkValidity()) {
    form.reportValidity?.();
    return;
  }

  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  const submitBtn = form?.querySelector('button[type="submit"]');

  if (errorEl) errorEl.textContent = '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Logging in...';
  }

  try {
    await auth.login(username, password);
    showMainApp();
    if (typeof initializeApp === 'function') {
      await initializeApp();
    }
  } catch (error) {
    if (errorEl) errorEl.textContent = error.message;
    showToast(error.message, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign in to workspace →';
    }
  }
}

function handleLogout() {
  auth.logout();
  showLoginScreen();
}

function setupAuthListeners() {
  const form = document.getElementById('login-form');
  if (form && !form.dataset.authBound) {
    form.addEventListener('submit', handleLoginSubmit);
    form.dataset.authBound = 'true';
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn && !logoutBtn.dataset.authBound) {
    logoutBtn.addEventListener('click', handleLogout);
    logoutBtn.dataset.authBound = 'true';
  }

  document.addEventListener('click', () => auth.resetSessionTimer());
  document.addEventListener('keypress', () => auth.resetSessionTimer());
}

async function initAuth() {
  try {
    const hasSession = await auth.init();
    if (hasSession) {
      showMainApp();
      initializeApp();
    } else {
      showLoginScreen();
    }
    setupAuthListeners();
  } catch (error) {
    console.error('Auth init failed:', error);
    showLoginScreen();
    setupAuthListeners();
  }
}

// Make auth globally accessible
window.auth = auth;