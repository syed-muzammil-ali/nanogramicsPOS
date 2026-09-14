/**
 * AUDIT LOG MODULE — FIXED
 *
 * Root cause of bug: isInitialized flag was preventing setupEventListeners()
 * from running on subsequent tab visits. Also date filters were not passed
 * to backend correctly.
 *
 * Fix: Separate listenersSetup flag from isInitialized so listeners attach
 * once and data always refreshes on every tab open.
 */

class AuditManager {
  constructor() {
    this.auditLogs  = [];
    this.startDate  = getTodayDate();
    this.endDate    = getTodayDate();
    this.isInitialized  = false;
    this.listenersSetup = false;   // ← NEW: separate flag for event listeners
  }

  // ── INIT ─────────────────────────────────────────────────────
  // Called every time the audit tab is opened.
  // Listeners are bound only once; data always refreshes.
  async init() {
    // Bind buttons only on first call
    if (!this.listenersSetup) {
      this.setupEventListeners();
      this.listenersSetup = true;
      console.log('Audit: event listeners attached');
    }

    // Set default dates if inputs are empty
    const startInput = document.getElementById('audit-start-date');
    const endInput   = document.getElementById('audit-end-date');
    if (startInput && !startInput.value) startInput.value = this.startDate;
    if (endInput   && !endInput.value)   endInput.value   = this.endDate;

    // Always refresh data when tab is opened
    await this.loadAuditLogs();
    this.isInitialized = true;
    console.log('Audit: initialized');
  }

  // ── LOAD AUDIT LOGS ──────────────────────────────────────────
  async loadAuditLogs() {
    const tbody = document.getElementById('audit-log-body');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="padding:30px;text-align:center;color:#6b7280;font-size:13px;">
             Loading audit logs...
          </td>
        </tr>`;
    }

    try {
      const start  = document.getElementById('audit-start-date')?.value || this.startDate;
      const end    = document.getElementById('audit-end-date')?.value   || this.endDate;
      const search = document.getElementById('audit-search')?.value?.trim() || '';

      // Build filters — backend now supports startDate / endDate
      const filters = { startDate: start, endDate: end };
      if (search) filters.action = search;

      this.auditLogs = await API.getAuditLogs(filters);
      this.renderAuditLogs();
      this.renderStats();
    } catch (error) {
      console.error('Load audit logs error:', error);
      showToast('Failed to load audit logs: ' + error.message, 'error');
      const tb = document.getElementById('audit-log-body');
      if (tb) {
        tb.innerHTML = `
          <tr>
            <td colspan="9" style="padding:30px;text-align:center;color:#ef4444;font-size:13px;">
               Failed to load audit logs: ${error.message}
            </td>
          </tr>`;
      }
    }
  }

  // ── RENDER AUDIT LOGS ────────────────────────────────────────
  renderAuditLogs() {
    const tbody = document.getElementById('audit-log-body');
    if (!tbody) return;

    if (!this.auditLogs || this.auditLogs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="padding:30px;text-align:center;color:#6b7280;font-size:13px;">
             No audit logs found for this period
          </td>
        </tr>`;
      return;
    }

    const systemColors = {
      'Online':  { bg: '#0d2e1a', color: '#10b981' },
      'Offline': { bg: '#1a1a2e', color: '#60a5fa' }
    };

    const actionColors = {
      'Login':                '#22c55e',
      'Logout':               '#ef4444',
      'Online Order Created': '#3b82f6',
      'Offline Sale Created': '#8b5cf6',
      'Return Processed':     '#f59e0b',
      'Exchange Completed':   '#ec4899',
      'Product Added':        '#10b981',
      'Product Updated':      '#f5c542',
      'Product Deleted':      '#ef4444',
      'User Created':         '#06b6d4',
      'User Edited':          '#8b5cf6',
      'User Deleted':         '#ef4444',
      'Password Reset':       '#f472b6',
      'Settings Changed':     '#f97316',
      'Inventory Updated':    '#22d3ee',
      'Order Edited':         '#fbbf24',
      'Order Deleted':        '#ef4444',
      'Backup Created':       '#84cc16',
    };

    const actionIcons = {
      'Login':                '',
      'Logout':               '',
      'Online Order Created': '',
      'Offline Sale Created': '',
      'Return Processed':     '',
      'Exchange Completed':   '',
      'Product Added':        '',
      'Product Updated':      '',
      'Product Deleted':      '',
      'User Created':         '',
      'User Edited':          '',
      'User Deleted':         '',
      'Password Reset':       '',
      'Settings Changed':     '',
      'Inventory Updated':    '',
      'Order Edited':         '',
      'Order Deleted':        '',
      'Backup Created':       '',
    };

    tbody.innerHTML = this.auditLogs.map((log, index) => {
      const sysInfo     = systemColors[log.system_type] || systemColors['Offline'];
      const actionColor = actionColors[log.action]      || '#9ca3af';
      const icon        = actionIcons[log.action]       || '';

      return `
        <tr style="border-bottom:1px solid var(--border);">
          <td style="padding:8px 12px;color:var(--muted);font-size:11px;text-align:center;">${index + 1}</td>
          <td style="padding:8px 12px;font-size:11px;">
            <div style="font-weight:600;">${formatDate(log.created_at)}</div>
            <div style="color:var(--muted);font-size:10px;">${formatTime(log.created_at)}</div>
          </td>
          <td style="padding:8px 12px;font-weight:700;color:var(--yellow);font-size:12px;">${log.username || '—'}</td>
          <td style="padding:8px 12px;">
            <span style="padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;
              background:${log.user_role === 'admin' ? '#1a0a2e' : '#0a1a2e'};
              color:${log.user_role === 'admin' ? '#c084fc' : '#60a5fa'};">
              ${log.user_role || 'user'}
            </span>
          </td>
          <td style="padding:8px 12px;">
            <span style="padding:2px 8px;border-radius:8px;font-size:10px;font-weight:700;
              background:${sysInfo.bg};color:${sysInfo.color};">
              ${log.system_type || 'Offline'}
            </span>
          </td>
          <td style="padding:8px 12px;font-size:12px;">
            <span style="color:${actionColor};">${icon} ${log.action || '—'}</span>
          </td>
          <td style="padding:8px 12px;font-family:monospace;font-size:11px;color:var(--yellow);">
            ${log.invoice_number || '—'}
          </td>
          <td style="padding:8px 12px;font-size:12px;">${log.customer_name || '—'}</td>
          <td style="padding:8px 12px;font-size:11px;color:var(--muted);max-width:200px;word-break:break-word;">
            ${log.details || '—'}
          </td>
        </tr>`;
    }).join('');
  }

  // ── RENDER STATS ──────────────────────────────────────────────
  renderStats() {
    const statsEl = document.getElementById('audit-stats');
    if (!statsEl) return;

    const total        = this.auditLogs.length;
    const uniqueUsers  = new Set(this.auditLogs.map(l => l.username)).size;
    const uniqueActions = new Set(this.auditLogs.map(l => l.action)).size;

    statsEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:12px;">
        <div class="stat-card" style="border-color:#f5c542;">
          <div class="stat-label"> Total Entries</div>
          <div class="stat-value" style="color:var(--yellow);">${total}</div>
        </div>
        <div class="stat-card" style="border-color:#a78bfa;">
          <div class="stat-label"> Unique Users</div>
          <div class="stat-value" style="color:#a78bfa;">${uniqueUsers}</div>
        </div>
        <div class="stat-card" style="border-color:#34d399;">
          <div class="stat-label"> Action Types</div>
          <div class="stat-value" style="color:#34d399;">${uniqueActions}</div>
        </div>
      </div>`;
  }

  // ── EXPORT CSV ────────────────────────────────────────────────
  exportCSV() {
    if (!this.auditLogs || this.auditLogs.length === 0) {
      showToast('No data to export', 'warning');
      return;
    }

    let csv  = 'LAJPAL BRAND HUB - AUDIT LOG\n';
    csv += `Generated: ${new Date().toLocaleString()}\n\n`;
    csv += 'Date,Time,User,Role,System,Action,Invoice,Customer,Details\n';

    this.auditLogs.forEach(log => {
      const date = formatDate(log.created_at);
      const time = formatTime(log.created_at);
      csv += `"${date}","${time}","${log.username}","${log.user_role || 'user'}","${log.system_type || 'Offline'}","${log.action}","${log.invoice_number || ''}","${log.customer_name || ''}","${(log.details || '').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href     = url;
    link.download = `audit_log_${this.startDate}_${this.endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('Audit log exported successfully', 'success');
  }

  // ── CLEAR OLD LOGS ────────────────────────────────────────────
  async clearOldLogs() {
    const confirmed = await showConfirm(
      'Clear Old Logs',
      'Delete all audit logs older than 90 days?\n\nThis action cannot be undone.'
    );
    if (!confirmed) return;

    try {
      await API.clearOldAuditLogs(90);
      showToast('Old audit logs cleared successfully', 'success');
      await this.loadAuditLogs();
    } catch (error) {
      console.error('Clear logs error:', error);
      showToast('Failed to clear logs: ' + error.message, 'error');
    }
  }

  // ── EVENT LISTENERS ───────────────────────────────────────────
  // Called only once (guarded by listenersSetup flag in init).
  setupEventListeners() {
    document.getElementById('btn-filter-audit')?.addEventListener('click', () => {
      this.loadAuditLogs();
    });

    document.getElementById('btn-refresh-audit')?.addEventListener('click', () => {
      this.loadAuditLogs();
    });

    document.getElementById('btn-export-audit')?.addEventListener('click', () => {
      this.exportCSV();
    });

    document.getElementById('btn-clear-old-audit')?.addEventListener('click', () => {
      this.clearOldLogs();
    });

    // Enter key in search box triggers filter
    document.getElementById('audit-search')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.loadAuditLogs();
    });

    // Auto-reload on date change
    document.getElementById('audit-start-date')?.addEventListener('change', () => {
      this.loadAuditLogs();
    });
    document.getElementById('audit-end-date')?.addEventListener('change', () => {
      this.loadAuditLogs();
    });

    console.log('Audit: all button listeners attached');
  }
}

// ── GLOBAL INSTANCE ───────────────────────────────────────────
const auditManager = new AuditManager();
window.auditManager = auditManager;
window.audit        = auditManager;

console.log('Audit module loaded');