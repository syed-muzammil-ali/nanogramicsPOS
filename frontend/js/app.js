/**
 * APP.JS - MAIN APPLICATION
 * 
 * Initializes and orchestrates all modules:
 * - Authentication
 * - UI setup
 * - Database operations
 * - Module initialization
 */

/**
 * Check if running in Electron
 */
function isElectron() {
  return typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';
}

/**
 * Initialize application
 */
async function initializeApp() {
  try {
    console.log('Initializing application...');

    // Check Electron API
    if (!isElectron()) {
      console.warn('Not running in Electron - offline features may be limited');
    }

    // Initialize UI
    console.log('Initializing UI...');
    initializeUI();

    // Initialize modules
    console.log('Initializing modules...');
    
    // Make sure all modules are initialized
    const modules = [];
    const allowed = getUserPermissions();
    
    if (allowed.includes('inventory') && typeof inventory !== 'undefined' && inventory.init) {
      modules.push(inventory.init());
    }
    
    if (allowed.includes('sales') && typeof sales !== 'undefined' && sales.init) {
      modules.push(sales.init());
    }
    
    if (allowed.includes('reports') && typeof reports !== 'undefined' && reports.init) {
      modules.push(reports.init());
    }
    
    if (allowed.includes('online') && typeof onlineManager !== 'undefined' && onlineManager.init) {
      modules.push(onlineManager.init());
    } else if (allowed.includes('online') && typeof online !== 'undefined' && online.init) {
      modules.push(online.init());
    }
    
    if (allowed.includes('returns') && typeof returnsManager !== 'undefined' && returnsManager.init) {
      modules.push(returnsManager.init());
    }
    
    if (allowed.includes('exchange') && typeof exchangeManager !== 'undefined' && exchangeManager.init) {
      modules.push(exchangeManager.init());
    }
    
    // Audit module - only if admin
    if (typeof auditManager !== 'undefined' && auth.isAdmin()) {
      modules.push(auditManager.init());
    }

    const results = await Promise.allSettled(modules);
    const failures = results.filter(result => result.status === 'rejected');

    if (failures.length > 0) {
      console.warn('Some modules failed to initialize:', failures.map(f => f.reason));
    }

    console.log('Application initialized successfully');
    showToast(failures.length > 0 ? 'Application ready with warnings' : 'Application ready', 'success');
  } catch (error) {
    console.error('Initialization failed:', error);
    showToast('Failed to initialize application: ' + error.message, 'error');
  }
}

/**
 * Graceful shutdown
 */
async function shutdown() {
  try {
    console.log('Shutting down...');
    // Add cleanup code here if needed
  } catch (error) {
    console.error('Shutdown error:', error);
  }
}

/**
 * Handle errors globally
 */
window.addEventListener('error', (event) => {
  const message = event?.error?.message || String(event?.message || 'An unexpected error occurred');
  console.error('Uncaught error:', event.error || event.message);
  showToast('An error occurred: ' + message, 'error');
});

/**
 * Handle unhandled promise rejections
 */
window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const message = reason?.message || String(reason || 'Unhandled promise rejection');
  console.error('Unhandled promise rejection:', reason);
  showToast('An error occurred: ' + message, 'error');
});

/**
 * Setup page visibility handling
 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('App is hidden');
  } else {
    console.log('App is visible');
    // Refresh data when tab becomes visible
    if (typeof auth !== 'undefined' && auth.isLoggedIn()) {
      try {
        if (typeof inventory !== 'undefined' && inventory.loadProducts) {
          inventory.loadProducts();
        }
      } catch (error) {
        console.error('Failed to refresh inventory:', error);
      }
    }
  }
});

/**
 * Main entry point - wait for DOM to be ready
 */
async function main() {
  try {
    console.log('Nanogramics | nanogramics_pos_1.5 starting...');
    console.log('Environment:', isElectron() ? 'Electron' : 'Browser');

    // Initialize authentication
    await initAuth();
  } catch (error) {
    console.error('Fatal startup error:', error);
    showToast('Failed to start application', 'error');
  }
}

// Start app when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', main);
} else {
  main();
}

// Handle window close
window.addEventListener('beforeunload', (event) => {
  // Optional: confirm before closing
  // event.preventDefault();
  // event.returnValue = '';
});
