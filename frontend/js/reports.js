/**
 * REPORTS MODULE — FULL COMBINED REPORT
 * - Offline + Online orders
 * - Weekly / Monthly presets
 * - City breakdown, returns, customer list
 * - PDF & CSV download
 * - Admin-only sale delete
 */

class ReportsManager {
  constructor() {
    this.reportData  = null;
    this.fullData    = null;   // combined report
    this.startDate   = getTodayDate();
    this.endDate     = getTodayDate();
    this.activeTab   = 'combined'; // combined | offline | online
  }

  formatShortDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const day = d.getDate();
    const month = d.toLocaleDateString('en-PK', { month: 'short' });
    return `${day}-${month}`;
  }

  // Format date as DD-Mon-YYYY (e.g., 03-Jul-2026)
  formatOrderDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const day = d.getDate();
    const month = d.toLocaleDateString('en-PK', { month: 'short' });
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }

  // Format products with bullet points
  formatProductsWithBullets(items) {
    if (!Array.isArray(items) || items.length === 0) return '—';
    return items.map(item => `• ${item.name || item.code || ''} ×${item.qty || 1}`).join('<br>');
  }

  // Calculate total pieces from items
  calculateTotalPieces(items) {
    if (!Array.isArray(items) || items.length === 0) return 0;
    return items.reduce((sum, item) => sum + (parseInt(item.qty) || 0), 0);
  }

  async init() {
    this.setupEventListeners();
    document.getElementById('report-start-date').value = this.startDate;
    document.getElementById('report-end-date').value   = this.endDate;
  }

  // ── DATE PRESETS ─────────────────────────────────────────────
  setWeekly() {
    const end   = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    this.startDate = start.toISOString().split('T')[0];
    this.endDate   = end.toISOString().split('T')[0];
    document.getElementById('report-start-date').value = this.startDate;
    document.getElementById('report-end-date').value   = this.endDate;
    this.generateReport();
  }

  setMonthly() {
    const now = new Date();
    this.startDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    this.endDate   = now.toISOString().split('T')[0];
    document.getElementById('report-start-date').value = this.startDate;
    document.getElementById('report-end-date').value   = this.endDate;
    this.generateReport();
  }

  // ── GENERATE ─────────────────────────────────────────────────
  async generateReport() {
    try {
      this.startDate = document.getElementById('report-start-date').value;
      this.endDate   = document.getElementById('report-end-date').value;

      if (!this.startDate || !this.endDate) { showToast('Please select date range', 'warning'); return; }
      if (this.startDate > this.endDate)    { showToast('Start date cannot be after end date', 'warning'); return; }

      showToast('Generating report...', 'info');

      // Fetch both
      const [salesData, fullData, perfData] = await Promise.all([
        API.getSalesReport(this.startDate, this.endDate),
        API.getFullReport(this.startDate, this.endDate),
        API.getUserPerformance(this.startDate, this.endDate),
      ]);

      this.reportData = salesData;
      this.fullData   = fullData;
      this.perfData   = perfData;

      this.renderAll();
      showToast('Report ready', 'success');
    } catch (err) {
      console.error('Report error:', err);
      showToast(err.message || 'Failed to generate report', 'error');
    }
  }

  // ── RENDER ALL ────────────────────────────────────────────────
  renderAll() {
    this.renderSummaryStats();
    this.renderReportTabs();
  }

  // ── REFRESH CURRENT REPORT (for bulk actions) ─────────────────
  async refreshCurrentReport() {
    if (this.fullData && this.startDate && this.endDate) {
      try {
        const [salesData, fullData, perfData] = await Promise.all([
          API.getSalesReport(this.startDate, this.endDate),
          API.getFullReport(this.startDate, this.endDate),
          API.getUserPerformance(this.startDate, this.endDate),
        ]);
        this.reportData = salesData;
        this.fullData = fullData;
        this.perfData = perfData;
        this.renderAll();
      } catch (err) {
        console.error('Report refresh error:', err);
      }
    }
  }

  // ── SUMMARY STAT CARDS ───────────────────────────────────────
   renderSummaryStats() {
     const statsEl = document.getElementById('report-stats');
     if (!statsEl || !this.fullData) return;
     const { combined, offline, online } = this.fullData;

     // Use the new piece calculations from the backend
     const grandTotalPieces = online.summary.grandTotalPieces || 0;
     const returnPieces = online.summary.returnPieces || 0;
     const totalPieces = online.summary.totalPieces || 0;
     const netOnlineRevenue = online.summary.netOnlineRevenue || 0;

     statsEl.innerHTML = `
       <div class="stat-card"><div class="stat-label">Net revenue after returns &amp; exchanges</div><div class="stat-value">Rs ${formatCurrency(combined.netRevenue ?? combined.totalRevenue)}</div></div>
       <div class="stat-card"><div class="stat-label">Return / exchange refunds</div><div class="stat-value">Rs ${formatCurrency(this.fullData.adjustments?.summary.refundAmount || 0)}</div></div>
       <div class="stat-card" style="border-color:#f5c542;">
         <div class="stat-label"> Total Revenue</div>
         <div class="stat-value gold">Rs ${formatCurrency(combined.totalRevenue)}</div>
       </div>
       <div class="stat-card">
         <div class="stat-label"> Offline Sales</div>
         <div class="stat-value">${offline.summary.totalSales}</div>
       </div>
       <div class="stat-card">
         <div class="stat-label"> Offline Revenue</div>
         <div class="stat-value green">Rs ${formatCurrency(offline.summary.totalRevenue)}</div>
       </div>
       <div class="stat-card">
         <div class="stat-label"> Shipped Orders</div>
         <div class="stat-value">${online.summary.shipping}</div>
       </div>
       <div class="stat-card">
         <div class="stat-label"> Gross Online Revenue</div>
         <div class="stat-value green">Rs ${formatCurrency(online.summary.totalRevenue)}</div>
       </div>
       <div class="stat-card" style="border-color:#10b981;">
         <div class="stat-label"> Net Online Revenue</div>
         <div class="stat-value" style="color:#10b981;">Rs ${formatCurrency(netOnlineRevenue)}</div>
       </div>
       <div class="stat-card" style="border-color:#ef4444;">
         <div class="stat-label"> Returned</div>
         <div class="stat-value" style="color:#ef4444;">${online.summary.returned} orders</div>
         <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Rs ${formatCurrency(online.summary.returnedAmount||0)} (excluded)</div>
       </div>
       <div class="stat-card" style="border-color:#10b981;">
         <div class="stat-label"> Grand Total Pieces</div>
         <div class="stat-value" style="color:#10b981;">${grandTotalPieces}</div>
       </div>
       <div class="stat-card" style="border-color:#ef4444;">
         <div class="stat-label"> Return Pieces</div>
         <div class="stat-value" style="color:#ef4444;">${returnPieces}</div>
       </div>
       <div class="stat-card" style="border-color:#3b82f6;">
         <div class="stat-label"> Total Pieces</div>
         <div class="stat-value" style="color:#3b82f6;">${totalPieces}</div>
       </div>
       <div class="stat-card">
         <div class="stat-label"> Transactions</div>
         <div class="stat-value">${combined.totalTransactions}</div>
       </div>
     `;
     const extra = [...statsEl.children].slice(3);
     const details = document.createElement('details'); details.className='report-more-metrics';
     const summary = document.createElement('summary'); summary.textContent='Operational metrics · '+extra.length;
     const grid = document.createElement('div'); grid.className='report-metrics-grid';
     extra.forEach(card=>grid.append(card)); details.append(summary,grid);statsEl.append(details);
   }

  // ── REPORT TABS ───────────────────────────────────────────────
  renderReportTabs() {
    const tableEl = document.getElementById('report-table');
    if (!tableEl) return;

    tableEl.innerHTML = `
      <!-- Tab buttons -->
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
        <button onclick="reports.switchTab('combined')" id="rtab-combined"
          class="filter-tab ${this.activeTab==='combined'?'active':''}"> Combined</button>
        <button onclick="reports.switchTab('offline')" id="rtab-offline"
          class="filter-tab ${this.activeTab==='offline'?'active':''}"> Offline Sales</button>
        <button onclick="reports.switchTab('wholesale')" id="rtab-wholesale"
          class="filter-tab ${this.activeTab==='wholesale'?'active':''}"> Wholesale</button>
        <button onclick="reports.switchTab('online')" id="rtab-online"
          class="filter-tab ${this.activeTab==='online'?'active':''}"> Shipped /  Returned</button>
        <button onclick="reports.switchTab('adjustments')" id="rtab-adjustments" class="filter-tab ${this.activeTab==='adjustments'?'active':''}">Returns &amp; Exchanges</button>
        <button onclick="reports.switchTab('cities')" id="rtab-cities"
          class="filter-tab ${this.activeTab==='cities'?'active':''}"> City Breakdown</button>
        <button onclick="reports.switchTab('returns')" id="rtab-returns"
          class="filter-tab ${this.activeTab==='returns'?'active':''}"> Online Returns</button>
        ${auth.isAdmin() ? `<button onclick="reports.switchTab('performance')" id="rtab-performance"
          class="filter-tab ${this.activeTab==='performance'?'active':''}"> User Performance</button>` : ''}
      </div>
      <div id="report-tab-content"></div>
    `;

    this.renderActiveTab();
  }

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('[id^="rtab-"]').forEach(b => b.classList.remove('active'));
    const el = document.getElementById(`rtab-${tab}`);
    if (el) el.classList.add('active');
    this.renderActiveTab();
  }

  renderActiveTab() {
    const el = document.getElementById('report-tab-content');
    if (!el || !this.fullData) return;
    switch (this.activeTab) {
      case 'combined':     el.innerHTML = this.buildCombinedHTML();     break;
      case 'offline':      el.innerHTML = this.buildOfflineHTML();       break;
      case 'wholesale':    el.innerHTML = this.buildWholesaleHTML();     break;
      case 'online':       el.innerHTML = this.buildOnlineHTML();        break;
      case 'cities':       el.innerHTML = this.buildCitiesHTML();        break;
      case 'adjustments': el.innerHTML = this.buildAdjustmentsHTML(); break;
      case 'returns':      el.innerHTML = this.buildReturnsHTML();       break;
      case 'performance':  el.innerHTML = this.buildPerformanceHTML();   break;
    }
  }

  adjustmentCSV() {
    const cell=v=>'"'+String(v??'').replace(/^[=+@-]/,"'").replace(/"/g,'""')+'"';
    const rows=(this.fullData.adjustments?.rows || []).map(r=>[r.invoiceNumber,r.mode,r.originalInvoiceId,r.invoiceType,r.created_at,r.items.map(i=>(i.name||i.product_name||i.code)+' x '+i.qty).join(' | '),r.newItems.map(i=>(i.name||i.code)+' x '+i.qty).join(' | '),r.credit,r.newAmount,r.refundAmount,r.additionalAmount,r.reason,r.username].map(cell).join(','));
    return '\nRETURNS AND EXCHANGES\nInvoice,Type,Original invoice,Source,Date,Products received,Replacement products,Credit,Replacement total,Refund,Additional payment,Reason,User\n'+rows.join('\n')+'\n';
  }
  buildAdjustmentsHTML(printable=false) {
    const data=this.fullData.adjustments || {rows:[],summary:{}};
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const products=items=>items.map(i=>esc(i.name||i.product_name||i.code)+' × '+esc(i.qty)).join('<br>')||'—';
    return '<p>Net revenue after returns and exchanges: Rs '+formatCurrency(this.fullData.combined?.netRevenue ?? this.fullData.combined?.totalRevenue ?? 0)+'</p><h3>Returns &amp; Exchanges</h3><p>Saved by transaction date for the selected report period.</p><p>Return invoices: '+(data.summary.returns||0)+' | Exchange invoices: '+(data.summary.exchanges||0)+' | Refunds: Rs '+formatCurrency(data.summary.refundAmount||0)+' | Additional payments: Rs '+formatCurrency(data.summary.additionalAmount||0)+'</p><div style="overflow:auto"><table style="width:100%"><thead><tr><th>Invoice / original</th><th>Type / source</th><th>Date / user</th><th>Products received</th><th>Replacements</th><th>Refund</th><th>Additional payment</th><th>Reason</th>'+(printable?'':'<th>Receipt</th>')+'</tr></thead><tbody>'+data.rows.map((r,k)=>'<tr><td>'+esc(r.invoiceNumber)+'<br>'+esc(r.originalInvoiceId)+'</td><td>'+esc(r.mode)+'<br>'+esc(r.invoiceType)+'</td><td>'+esc(this.formatOrderDate(r.created_at))+'<br>'+esc(r.username)+'</td><td>'+products(r.items)+'</td><td>'+products(r.newItems)+'</td><td>Rs '+formatCurrency(r.refundAmount)+'</td><td>Rs '+formatCurrency(r.additionalAmount)+'</td><td>'+esc(r.reason)+'</td>'+(printable?'':'<td><button class="btn-secondary" onclick="reports.reprintAdjustment('+k+')">Reprint</button></td>')+'</tr>').join('')+(data.rows.length?'':'<tr><td colspan="9">No return or exchange invoices in this period.</td></tr>')+'</tbody></table></div>';
  }
  reprintAdjustment(index) { const r=this.fullData.adjustments?.rows[index];if(r) returnsManager.print(r); }
  getVisibleOnlineOrders() {
    const orders = this.fullData?.online?.orders || [];
    return orders.filter(o => {
      const status = String(o.order_status || '').toLowerCase().trim();
      return ['shipping', 'shipped', 'delivered', 'return'].includes(status);
    });
  }

  // ── COMBINED TAB ──────────────────────────────────────────────
  buildCombinedHTML() {
    const { offline, online, combined } = this.fullData;
    const isAdmin = auth.isAdmin();
    const visibleOnlineOrders = this.getVisibleOnlineOrders();
    
    // Use the new piece calculations from the backend
    const grandTotalPieces = online.summary.grandTotalPieces || 0;
    const returnPieces = online.summary.returnPieces || 0;
    const totalPieces = online.summary.totalPieces || 0;
    const netOnlineRevenue = online.summary.netOnlineRevenue || 0;

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
        <div style="background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:16px;">
          <div style="color:var(--yellow);font-weight:700;margin-bottom:10px;"> Offline Summary</div>
          <div class="rrow"><span>Sales</span><span>${offline.summary.totalSales}</span></div>
          <div class="rrow"><span>Revenue</span><span style="color:#10b981;">Rs ${formatCurrency(offline.summary.totalRevenue)}</span></div>
          <div class="rrow"><span>Discount</span><span style="color:#ef4444;">-Rs ${formatCurrency(offline.summary.totalDiscount)}</span></div>
          <div class="rrow"><span>Items Sold</span><span>${offline.summary.totalItems}</span></div>
        </div>
        <div style="background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:16px;">
          <div style="color:var(--yellow);font-weight:700;margin-bottom:10px;"> Online Summary</div>
          <div class="rrow"><span>Orders</span><span>${online.summary.totalOrders}</span></div>
          <div class="rrow"><span>Gross Revenue</span><span style="color:#10b981;">Rs ${formatCurrency(online.summary.totalRevenue)}</span></div>
          <div class="rrow"><span>Net Revenue</span><span style="color:#3b82f6;font-weight:700;">Rs ${formatCurrency(netOnlineRevenue)}</span></div>
          <div class="rrow"><span>Paid</span><span style="color:#10b981;">${online.summary.paid}</span></div>
          <div class="rrow"><span>COD</span><span style="color:#f5c542;">${online.summary.cod}</span></div>
          <div class="rrow"><span> Shipped</span><span style="color:#3b82f6;">${online.summary.shipping}</span></div>
          <div class="rrow"><span> Returned Orders</span><span style="color:#ef4444;font-weight:700;">${online.summary.returned}</span></div>
          <div class="rrow"><span> Return Amount</span><span style="color:#ef4444;">Rs ${formatCurrency(online.summary.returnedAmount||0)}</span></div>
          <div class="rrow"><span>Grand Total Pieces</span><span style="color:#10b981;font-weight:700;">${grandTotalPieces}</span></div>
          <div class="rrow"><span>Return Pieces</span><span style="color:#ef4444;font-weight:700;">${returnPieces}</span></div>
          <div class="rrow"><span>Total Pieces</span><span style="color:#3b82f6;font-weight:700;">${totalPieces}</span></div>
        </div>
      </div>
      <div style="background:var(--panel2);border:2px solid var(--yellow);border-radius:12px;padding:16px;margin-bottom:20px;">
        <div style="color:var(--yellow);font-weight:800;font-size:16px;margin-bottom:8px;"> Combined Total Revenue</div>
        <div style="font-size:28px;font-weight:900;color:#10b981;">Rs ${formatCurrency(combined.totalRevenue)}</div>
        <div style="color:var(--muted);font-size:13px;margin-top:4px;">Period: ${this.startDate} → ${this.endDate}</div>
        ${online.summary.returnedAmount > 0 ? `
        <div style="margin-top:10px;background:#2a0a0a;border:1px solid #7f1d1d;border-radius:8px;padding:8px 12px;font-size:12px;">
          <span style="color:#fca5a5;"> Return amount <strong>NOT included</strong> in revenue above:</span>
          <span style="color:#ef4444;font-weight:800;margin-left:8px;">Rs ${formatCurrency(online.summary.returnedAmount)}</span>
          <span style="color:#9ca3af;margin-left:6px;">(${online.summary.returned} returned orders)</span>
        </div>` : ''}
      </div>
    `;
  }

  // ── OFFLINE TAB ───────────────────────────────────────────────
  buildOfflineHTML() {
    const { offline } = this.fullData;
    const isAdmin = auth.isAdmin();

    const productRows = (offline.productBreakdown || []).map(p => `
      <tr>
        <td style="font-family:monospace;font-size:11px;">${p.code}</td>
        <td>${p.name}</td>
        <td style="text-align:center;">${p.qty}</td>
        <td style="text-align:right;color:#f5c542;font-weight:700;">Rs ${formatCurrency(p.revenue)}</td>
      </tr>
    `).join('');

    const salesRows = (offline.sales || []).map(sale => {
      const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
      const invoiceId = escape(JSON.stringify(String(sale.id)));
      const delBtn = isAdmin
        ? `<button type="button" class="report-invoice-delete" title="Delete" aria-label="Delete sale ${escape(sale.id)}" onclick="reports.deleteSale(${invoiceId})">
              Delete</button>`
        : '';
      return `
        <tr>
          <td><div class="report-invoice-actions"><span class="report-invoice-id">#${escape(sale.id)}</span><button type="button" class="report-invoice-pdf" title="PDF / View Invoice" aria-label="View invoice PDF ${escape(sale.id)}" onclick="reports.viewInvoicePdf(${invoiceId}, this)">PDF</button>${delBtn}</div></td>
          <td>${formatDate(sale.created_at)}<br><span style="font-size:11px;color:#9ca3af;">${formatTime(sale.created_at)}</span></td>
          <td style="text-align:right;">Rs ${formatCurrency(sale.subtotal)}</td>
          <td style="text-align:right;color:#ef4444;">-Rs ${formatCurrency(sale.discount||0)}</td>
          <td style="text-align:right;color:#f5c542;font-weight:700;">Rs ${formatCurrency(sale.total)}</td>
          <td style="text-align:center;">${sale.payment_method||'—'}</td>
        </tr>`;
    }).join('');

    return `
      <h4 style="color:var(--yellow);margin-bottom:12px;"> Product Breakdown</h4>
      <div style="overflow-x:auto;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--panel2);">
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Code</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Product</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Qty</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Revenue</th>
          </tr></thead>
          <tbody>${productRows || '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--muted);">No data</td></tr>'}</tbody>
        </table>
      </div>
      <h4 style="color:var(--yellow);margin-bottom:12px;"> Individual Sales ${isAdmin?'<span style="font-size:11px;color:#6b7280;font-weight:400;">(Admin: delete available)</span>':''}</h4>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--panel2);">
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Sale ID</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Date & Time</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Subtotal</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Discount</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Total</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Payment</th>
          </tr></thead>
          <tbody>${salesRows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted);">No sales in this period</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  // ── WHOLESALE TAB ───────────────────────────────────────────
  buildWholesaleHTML() {
    const { wholesale } = this.fullData;
    const rows = (wholesale.sales || []).map(sale => `
      <tr>
        <td style="font-family:monospace;font-size:11px;">#${sale.id}</td>
        <td>${formatDate(sale.created_at)}<br><span style="font-size:11px;color:#9ca3af;">${formatTime(sale.created_at)}</span></td>
        <td style="text-align:right;">Rs ${formatCurrency(sale.subtotal || 0)}</td>
        <td style="text-align:right;color:#ef4444;">-Rs ${formatCurrency(sale.discount || 0)}</td>
        <td style="text-align:right;color:#f5c542;font-weight:700;">Rs ${formatCurrency(sale.total || 0)}</td>
        <td style="text-align:center;">${sale.payment_method || '—'}</td>
      </tr>
    `).join('');

    return `
      <div style="background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px;display:flex;gap:20px;flex-wrap:wrap;">
        <div><div style="color:var(--muted);font-size:11px;">Wholesale Sales</div><div style="font-size:20px;font-weight:800;">${wholesale.summary.totalSales}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Revenue</div><div style="font-size:20px;font-weight:800;color:#10b981;">Rs ${formatCurrency(wholesale.summary.totalRevenue)}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Items</div><div style="font-size:20px;font-weight:800;">${wholesale.summary.totalItems}</div></div>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--panel2);">
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Invoice</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Date</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Subtotal</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Discount</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Total</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Payment</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted);">No wholesale sales</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  // ── ONLINE TAB ────────────────────────────────────────────────
  buildOnlineHTML() {
    const { online } = this.fullData;
    const visibleOrders = this.getVisibleOnlineOrders();
    const statusColors = {
      pending: '#f59e0b', shipping: '#3b82f6',
      delivered: '#22c55e', return: '#ef4444'
    };
    const statusIcons = {
      pending: '', shipping: '', delivered: '', return: ''
    };

    // Use the new piece calculations from the backend
    const grandTotalPieces = online.summary.grandTotalPieces || 0;
    const returnPieces = online.summary.returnPieces || 0;
    const totalPieces = online.summary.totalPieces || 0;

    const rows = visibleOrders.map(o => {
      const st    = o.order_status || 'pending';
      const color = statusColors[st] || '#9ca3af';
      const icon  = statusIcons[st]  || '';
      const isPaid = o.payment_status === 'paid';
      const totalPieces = this.calculateTotalPieces(o.items);
      const productsList = this.formatProductsWithBullets(o.items);
      
      return `
        <tr style="${st === 'return' ? 'background:#1a0a0a;' : ''}">
          <td style="font-size:13px;">${o.customer_name||'—'}</td>
          <td style="text-align:center;">
            <span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${isPaid?'#0d2e1a':'#3a3313'};color:${isPaid?'#10b981':'#f5c542'};">
              ${isPaid?'Paid':'COD'}
            </span>
          </td>
          <td style="font-size:13px;">${o.city||'—'}</td>
          <td style="font-size:12px;white-space:pre-line;line-height:1.5;">${productsList}</td>
          <td style="text-align:center;font-weight:700;">${totalPieces}</td>
          <td style="text-align:right;color:#f5c542;font-weight:700;">Rs ${formatCurrency(o.total||0)}</td>
          <td style="text-align:center;color:${color};font-weight:700;font-size:12px;">${icon} ${st.charAt(0).toUpperCase()+st.slice(1)}</td>
          <td style="font-size:13px;">${this.formatOrderDate(o.created_at)}</td>
        </tr>`;
    }).join('');

    return `
      <h4 style="color:var(--yellow);margin-bottom:12px;"> Online Orders Report</h4>
      ${visibleOrders.length > 0 ? `
      <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;gap:20px;flex-wrap:wrap;">
        <div><span style="color:var(--muted);font-size:13px;">Grand Total Pieces: </span>
          <span style="color:#10b981;font-weight:800;font-size:16px;">${grandTotalPieces}</span></div>
        <div><span style="color:var(--muted);font-size:13px;">Return Pieces: </span>
          <span style="color:#ef4444;font-weight:800;font-size:16px;">${returnPieces}</span></div>
        <div><span style="color:var(--muted);font-size:13px;">Net Pieces: </span>
          <span style="color:#3b82f6;font-weight:800;font-size:16px;">${totalPieces}</span></div>
      </div>` : ''}
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--panel2);">
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Customer Name</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Payment Method</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">City</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Products & Qty</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Total Pieces</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Total Amount</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Order Status</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Order Date</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="8" style="text-align:center;padding:20px;color:var(--muted);">No online orders in this period</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  // ── RETURNS TAB (ONLINE RETURNS SECTION) ───────────────────────
  buildReturnsHTML() {
    const { online } = this.fullData;
    const simpleReturns = online.simpleReturns || [];

    const rows = simpleReturns.map(r => `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:10px 12px;font-size:12px;color:var(--muted);font-family:monospace;">#${r.id}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:700;">${formatDate(r.created_at)}</td>
        <td style="padding:10px 12px;text-align:center;font-weight:700;">${r.return_pieces || 0}</td>
        <td style="padding:10px 12px;text-align:right;font-weight:700;color:#ef4444;">Rs ${formatCurrency(r.return_amount || 0)}</td>
        <td style="padding:10px 12px;font-size:12px;color:#fca5a5;">${r.description || '—'}</td>
        <td style="padding:10px 12px;font-size:12px;color:var(--muted);">${r.username || '—'}</td>
      </tr>
    `).join('');

    const totalReturns = simpleReturns.length;
    const totalReturnAmount = simpleReturns.reduce((sum, r) => sum + (parseFloat(r.return_amount) || 0), 0);
    const totalReturnPieces = simpleReturns.reduce((sum, r) => sum + (parseInt(r.return_pieces) || 0), 0);

    return `
      <h4 style="color:var(--yellow);margin-bottom:12px;"> ONLINE RETURNS</h4>
      ${simpleReturns.length > 0 ? `
      <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;gap:20px;flex-wrap:wrap;">
        <div><span style="color:var(--muted);font-size:13px;">Total Returns: </span>
          <span style="color:#f5c542;font-weight:800;font-size:16px;">${totalReturns}</span></div>
        <div><span style="color:var(--muted);font-size:13px;">Total Return Amount: </span>
          <span style="color:#ef4444;font-weight:800;font-size:16px;">Rs ${formatCurrency(totalReturnAmount)}</span></div>
        <div><span style="color:var(--muted);font-size:13px;">Total Return Pieces: </span>
          <span style="color:#ef4444;font-weight:800;font-size:16px;">${totalReturnPieces}</span></div>
      </div>` : ''}
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--panel2);border-bottom:2px solid var(--border);">
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:var(--muted);">Return ID</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:var(--muted);">Date</th>
            <th style="padding:10px 12px;text-align:center;font-size:12px;color:var(--muted);">Pieces</th>
            <th style="padding:10px 12px;text-align:right;font-size:12px;color:var(--muted);">Amount</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:var(--muted);">Description</th>
            <th style="padding:10px 12px;text-align:left;font-size:12px;color:var(--muted);">User</th>
          </tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="padding:20px;text-align:center;color:#6b7280;font-size:13px;">No online returns in this period</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  // ── CITIES TAB ────────────────────────────────────────────────
  buildCitiesHTML() {
    const { online } = this.fullData;
    const cities = online.cityBreakdown || [];

    const rows = cities.map((c, i) => `
      <tr>
        <td style="font-weight:700;">${i+1}</td>
        <td style="font-weight:700;"> ${c.city}</td>
        <td style="text-align:center;">${c.orders}</td>
        <td style="text-align:right;color:#f5c542;font-weight:700;">Rs ${formatCurrency(c.revenue)}</td>
        <td style="text-align:center;color:#ef4444;font-weight:700;">${c.returned}</td>
        <td style="text-align:center;color:#10b981;">${c.delivered || 0}</td>
      </tr>
    `).join('');

    const totalOrders   = cities.reduce((s,c) => s + c.orders,  0);
    const totalRevenue  = cities.reduce((s,c) => s + c.revenue,  0);
    const totalReturned = cities.reduce((s,c) => s + c.returned, 0);
    const totalDelivered = cities.reduce((s,c) => s + (c.delivered || 0), 0);

    return `
      <h4 style="color:var(--yellow);margin-bottom:12px;"> City-wise Order Breakdown</h4>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:var(--panel2);">
            <th style="padding:8px;border-bottom:1px solid var(--border);">#</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">City</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Orders</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Revenue</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);"> Returned</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);"> Net Orders</th>
          </tr></thead>
          <tbody>
            ${rows || '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--muted);">No city data</td></tr>'}
            ${cities.length > 0 ? `
            <tr style="background:var(--panel2);font-weight:800;border-top:2px solid var(--yellow);">
              <td colspan="2">TOTAL</td>
              <td style="padding:8px;text-align:center;">${totalOrders}</td>
              <td style="padding:8px;text-align:right;color:#f5c542;">Rs ${formatCurrency(totalRevenue)}</td>
              <td style="padding:8px;text-align:center;color:#ef4444;">${totalReturned}</td>
              <td style="padding:8px;text-align:center;color:#10b981;">${totalDelivered}</td>
            </tr>` : ''}
          </tbody>
        </table>
      </div>
    `;
  }

  // ── DELETE SALE (admin only) ──────────────────────────────────
  async viewInvoicePdf(saleId, button) {
    if (button?.disabled) return;
    if (button) { button.disabled = true; button.textContent = 'Opening…'; }
    try {
      const result = await API.invoke('invoice:pdf:open', saleId);
      if (!result?.success) throw new Error(result?.error || 'Unable to open invoice PDF');
    } catch (error) {
      showToast(`Invoice PDF: ${error.message}. Click PDF to retry.`, 'error');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'PDF'; }
    }
  }

  // Delete retains the existing admin check, confirmation and API call.
  async deleteSale(saleId) {
    if (!auth.isAdmin()) { showToast('Only admin can delete sales', 'error'); return; }
    const confirmed = await showConfirm('Delete Sale', `Delete sale #${saleId}? This cannot be undone.`);
    if (!confirmed) return;
    try {
      await API.deleteSale(saleId);
      showToast(`Sale #${saleId} deleted`, 'success');
      await this.generateReport();
    } catch (err) {
      showToast('Failed to delete sale', 'error');
    }
  }

  // ── USER PERFORMANCE HTML ────────────────────────────────────────
  buildPerformanceHTML() {
    if (!auth.isAdmin()) return '<p style="color:var(--red);padding:20px;">Admin only</p>';
    if (!this.perfData || !this.perfData.users || this.perfData.users.length === 0) {
      return '<div class="empty-state"><p>No performance data for this period</p><small>Delivered orders created by logged-in users will appear here</small></div>';
    }

    const { users } = this.perfData;

    const rows = users.map((u, i) => `
      <tr>
        <td style="font-weight:700;">${i+1}</td>
        <td style="font-weight:800;color:var(--yellow);"> ${u.username}</td>
        <td style="text-align:center;">${u.deliveredOrders}</td>
        <td style="text-align:right;color:#10b981;font-weight:700;">Rs ${formatCurrency(u.deliveredSales)}</td>
        <td style="text-align:center;font-weight:700;">${u.deliveredPieces}</td>
        <td style="text-align:center;color:#ef4444;">${u.returnedOrders}</td>
        <td style="text-align:right;color:#ef4444;">Rs ${formatCurrency(u.returnedAmount)}</td>
        <td style="text-align:right;font-weight:800;color:#f5c542;">Rs ${formatCurrency(u.netSales)}</td>
      </tr>
    `).join('');

    const totals = users.reduce((acc, u) => ({
      deliveredOrders:  acc.deliveredOrders  + u.deliveredOrders,
      deliveredSales:   acc.deliveredSales   + u.deliveredSales,
      deliveredPieces:  acc.deliveredPieces  + u.deliveredPieces,
      returnedOrders:   acc.returnedOrders   + u.returnedOrders,
      returnedAmount:   acc.returnedAmount   + u.returnedAmount,
      netSales:         acc.netSales         + u.netSales,
    }), { deliveredOrders:0, deliveredSales:0, deliveredPieces:0, returnedOrders:0, returnedAmount:0, netSales:0 });

    const userOrderSections = users.map(u => {
      const orderRows = (u.orders || []).map(o => `
        <tr>
          <td style="font-family:monospace;font-size:11px;color:var(--yellow);">${o.orderId}</td>
          <td>${o.customer}</td>
          <td style="font-size:11px;">${o.city}</td>
          <td style="font-size:11px;">${this.formatShortDate(o.date)}</td>
          <td style="text-align:right;color:#f5c542;font-weight:700;">Rs ${formatCurrency(o.amount)}</td>
        </tr>
      `).join('');

      return `
        <div style="margin-top:20px;">
          <div style="color:var(--yellow);font-weight:800;margin-bottom:8px;">User: ${u.username}</div>
          <div style="color:var(--muted);font-size:12px;margin-bottom:8px;">Delivered Orders</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead><tr style="background:var(--panel2);">
                <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Order #</th>
                <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Customer</th>
                <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">City</th>
                <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Date</th>
                <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Amount</th>
              </tr></thead>
              <tbody>
                ${orderRows || '<tr><td colspan="5" style="text-align:center;padding:12px;color:var(--muted);">No delivered orders</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px;display:flex;gap:20px;flex-wrap:wrap;">
        <div><div style="color:var(--muted);font-size:11px;">Total Staff</div><div style="font-size:20px;font-weight:800;">${users.length}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Delivered Orders</div><div style="font-size:20px;font-weight:800;">${totals.deliveredOrders}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Delivered Pieces</div><div style="font-size:20px;font-weight:800;color:#10b981;">${totals.deliveredPieces}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Net Sales</div><div style="font-size:20px;font-weight:800;color:#f5c542;">Rs ${formatCurrency(totals.netSales)}</div></div>
        <div><div style="color:var(--muted);font-size:11px;">Total Returns</div><div style="font-size:20px;font-weight:800;color:#ef4444;">${totals.returnedOrders}</div></div>
      </div>
      <h4 style="color:var(--yellow);margin-bottom:12px;"> User-wise Performance</h4>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:var(--panel2);">
            <th style="padding:8px;border-bottom:1px solid var(--border);">#</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid var(--border);">Username</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Total Delivered Orders</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);">Total Delivered Sales</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);">Total Delivered Pieces</th>
            <th style="padding:8px;text-align:center;border-bottom:1px solid var(--border);color:#ef4444;">Returned Orders</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);color:#ef4444;">Returned Amount</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid var(--border);color:#f5c542;">Net Sales</th>
          </tr></thead>
          <tbody>
            ${rows}
            <tr style="background:var(--panel2);font-weight:800;border-top:2px solid var(--yellow);">
              <td colspan="2" style="padding:8px;">TOTAL</td>
              <td style="padding:8px;text-align:center;">${totals.deliveredOrders}</td>
              <td style="padding:8px;text-align:right;color:#10b981;">Rs ${formatCurrency(totals.deliveredSales)}</td>
              <td style="padding:8px;text-align:center;">${totals.deliveredPieces}</td>
              <td style="padding:8px;text-align:center;color:#ef4444;">${totals.returnedOrders}</td>
              <td style="padding:8px;text-align:right;color:#ef4444;">Rs ${formatCurrency(totals.returnedAmount)}</td>
              <td style="padding:8px;text-align:right;color:#f5c542;">Rs ${formatCurrency(totals.netSales)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      ${userOrderSections}
    `;
  }

  // ── DOWNLOAD PDF ──────────────────────────────────────────────
  downloadPDF() {
    if (!this.fullData) { showToast('Generate report first', 'warning'); return; }

    const { offline, online, combined, wholesale } = this.fullData;
    const period = `${this.startDate} to ${this.endDate}`;
    const visibleOnlineOrders = this.getVisibleOnlineOrders();

    // Use the new piece calculations from the backend
    const grandTotalPieces = online.summary.grandTotalPieces || 0;
    const returnPieces = online.summary.returnPieces || 0;
    const totalPieces = online.summary.totalPieces || 0;
    const netOnlineRevenue = online.summary.netOnlineRevenue || 0;

    // City rows
    const cityRows = (online.cityBreakdown || []).map((c,i) => `
      <tr>
        <td>${i+1}</td><td> ${c.city}</td>
        <td style="text-align:center;">${c.orders}</td>
        <td style="text-align:right;">Rs ${c.revenue.toLocaleString()}</td>
        <td style="text-align:center;color:#dc2626;">${c.returned}</td>
        <td style="text-align:center;color:#16a34a;">${c.delivered || 0}</td>
      </tr>`).join('');

    // Online order rows - NEW COLUMN STRUCTURE
    const onlineRows = visibleOnlineOrders.map(o => {
      const st = o.order_status || 'pending';
      const icons = { pending:'', shipping:'', delivered:'', return:'' };
      const isPaid = o.payment_status === 'paid';
      const totalPieces = this.calculateTotalPieces(o.items);
      const productsList = this.formatProductsWithBullets(o.items).replace(/<br>/g, '\n');
      const orderDate = this.formatOrderDate(o.created_at);
      return `<tr style="${st==='return'?'background:#fff0f0;':''}">
        <td>${o.customer_name||'—'}</td>
        <td style="text-align:center;">${isPaid?'Paid':'COD'}</td>
        <td>${o.city||'—'}</td>
        <td style="font-size:10px;white-space:pre;">${productsList}</td>
        <td style="text-align:center;font-weight:700;">${totalPieces}</td>
        <td style="text-align:right;font-weight:700;">Rs ${(o.total||0).toLocaleString()}</td>
        <td style="text-align:center;">${icons[st]||''} ${st.charAt(0).toUpperCase()+st.slice(1)}</td>
        <td>${orderDate}</td>
      </tr>`;
    }).join('');

    // Wholesale sale rows
    const wholesaleRows = (wholesale.sales || []).map(s => `
      <tr>
        <td style="font-family:monospace;font-size:10px;">#${s.id}</td>
        <td style="font-size:10px;">${s.created_at ? s.created_at.split('T')[0] : ''}</td>
        <td style="text-align:right;">Rs ${(s.subtotal || 0).toLocaleString()}</td>
        <td style="text-align:right;color:#dc2626;">-Rs ${(s.discount || 0).toLocaleString()}</td>
        <td style="text-align:right;font-weight:700;">Rs ${(s.total || 0).toLocaleString()}</td>
        <td>${s.payment_method || '—'}</td>
      </tr>`).join('');

    // Offline sale rows
    const offlineRows = (offline.sales || []).map(s => `
      <tr>
        <td style="font-family:monospace;font-size:10px;">#${s.id}</td>
        <td style="font-size:10px;">${s.created_at ? s.created_at.split('T')[0] : ''}</td>
        <td style="text-align:right;">Rs ${(s.subtotal||0).toLocaleString()}</td>
        <td style="text-align:right;color:#dc2626;">-Rs ${(s.discount||0).toLocaleString()}</td>
        <td style="text-align:right;font-weight:700;">Rs ${(s.total||0).toLocaleString()}</td>
        <td>${s.payment_method||'—'}</td>
      </tr>`).join('');

    // Online Returns rows
    const simpleReturns = online.simpleReturns || [];
    const returnsRows = simpleReturns.map(r => `
      <tr>
        <td style="font-family:monospace;font-size:10px;">#${r.id}</td>
        <td style="font-size:10px;">${r.created_at ? r.created_at.split('T')[0] : ''}</td>
        <td style="text-align:center;">${r.return_pieces || 0}</td>
        <td style="text-align:right;color:#dc2626;">Rs ${(r.return_amount || 0).toLocaleString()}</td>
        <td style="font-size:10px;">${r.description || '—'}</td>
        <td style="font-size:10px;">${r.username || '—'}</td>
      </tr>`).join('');

    const html = `<!DOCTYPE html><html><head>
      <meta charset="UTF-8">
      <title>Lajpal Report ${period}</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { font-family: Arial, sans-serif; font-size: 12px; color: #111; background: #fff; padding: 20px; }
        h1 { font-size: 22px; color: #b8860b; letter-spacing: 2px; }
        h2 { font-size: 15px; color: #333; margin: 18px 0 8px; border-bottom: 2px solid #b8860b; padding-bottom: 4px; }
        h3 { font-size: 13px; color: #555; margin: 14px 0 6px; }
        .header { text-align: center; border-bottom: 3px solid #b8860b; padding-bottom: 14px; margin-bottom: 18px; }
        .period { color: #666; font-size: 12px; margin-top: 4px; }
        .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
        .scard { border: 1px solid #ddd; border-radius: 8px; padding: 10px; text-align: center; }
        .scard .label { font-size: 10px; color: #888; margin-bottom: 4px; }
        .scard .value { font-size: 16px; font-weight: 800; color: #b8860b; }
        .scard.green .value { color: #16a34a; }
        .scard.red .value { color: #dc2626; }
        .scard.blue .value { color: #2563eb; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 16px; font-size: 11px; }
        th { background: #f5f5f0; padding: 7px 8px; text-align: left; border: 1px solid #ddd; font-weight: 700; }
        td { padding: 6px 8px; border: 1px solid #eee; }
        tr:nth-child(even) { background: #fafaf7; }
        .total-row { background: #fffbea !important; font-weight: 800; border-top: 2px solid #b8860b; }
        .big-total { background: #fffbea; border: 2px solid #b8860b; border-radius: 8px; padding: 14px; margin: 14px 0; text-align: center; }
        .big-total .label { font-size: 12px; color: #666; }
        .big-total .value { font-size: 26px; font-weight: 900; color: #16a34a; }
        .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px; }
        .box { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
        .box-title { font-weight: 800; color: #b8860b; margin-bottom: 8px; font-size: 13px; }
        .row { display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #f0f0f0; }
        .footer { text-align: center; margin-top: 24px; color: #999; font-size: 10px; border-top: 1px solid #eee; padding-top: 10px; }
        @media print { body { padding: 10px; } .no-print { display: none; } }
      </style>
    </head><body>

    <div class="header">
      <h1>LAJPAL BRAND HUB</h1>
      <div style="font-size:13px;color:#555;margin-top:4px;">Sales & Orders Report</div>
      <div class="period">Period: ${period}</div>
      <div class="period">Generated: ${new Date().toLocaleString('en-PK')}</div>
    </div>

    <!-- BIG COMBINED TOTAL -->
    <div class="big-total">
      <div class="label"> Total Combined Revenue</div>
      <div class="value">Rs ${combined.totalRevenue.toLocaleString()}</div>
      <div style="font-size:11px;color:#888;margin-top:4px;">${combined.totalTransactions} total transactions</div>
    </div>

    <!-- SUMMARY GRID -->
    <h2> Summary</h2>
    <div class="summary-grid">
      <div class="scard"><div class="label">Offline Sales</div><div class="value">${offline.summary.totalSales}</div></div>
      <div class="scard green"><div class="label">Offline Revenue</div><div class="value">Rs ${offline.summary.totalRevenue.toLocaleString()}</div></div>
      <div class="scard"><div class="label">Online Orders</div><div class="value blue" style="color:#2563eb;">${online.summary.totalOrders}</div></div>
      <div class="scard green"><div class="label">Online Revenue</div><div class="value">Rs ${online.summary.totalRevenue.toLocaleString()}</div></div>
      <div class="scard"><div class="label">Paid Online</div><div class="value blue" style="color:#2563eb;">${online.summary.paid}</div></div>
      <div class="scard"><div class="label">COD</div><div class="value" style="color:#d97706;">${online.summary.cod}</div></div>
      <div class="scard"><div class="label"> Shipped</div><div class="value">${online.summary.shipping || 0}</div></div>
      <div class="scard green"><div class="label"> Delivered</div><div class="value">${online.summary.delivered || 0}</div></div>
      <div class="scard red"><div class="label"> Returned</div><div class="value">${online.summary.returned}</div></div>
      <div class="scard" style="border-color:#10b981;"><div class="label"> Grand Total Pieces</div><div class="value" style="color:#10b981;">${grandTotalPieces}</div></div>
      <div class="scard" style="border-color:#ef4444;"><div class="label"> Return Pieces</div><div class="value" style="color:#ef4444;">${returnPieces}</div></div>
      <div class="scard" style="border-color:#3b82f6;"><div class="label"> Total Pieces</div><div class="value" style="color:#3b82f6;">${totalPieces}</div></div>
    </div>

    <!-- TWO COL: offline vs online -->
    <div class="two-col">
      <div class="box">
        <div class="box-title"> Offline Details</div>
        <div class="row"><span>Sales</span><span>${offline.summary.totalSales}</span></div>
        <div class="row"><span>Revenue</span><span>Rs ${offline.summary.totalRevenue.toLocaleString()}</span></div>
        <div class="row"><span>Discount Given</span><span>-Rs ${offline.summary.totalDiscount.toLocaleString()}</span></div>
        <div class="row"><span>Items Sold</span><span>${offline.summary.totalItems}</span></div>
      </div>
      <div class="box">
        <div class="box-title"> Online Details</div>
        <div class="row"><span>Total Orders</span><span>${online.summary.totalOrders}</span></div>
        <div class="row"><span>Revenue</span><span>Rs ${online.summary.totalRevenue.toLocaleString()}</span></div>
        <div class="row"><span>Shipped</span><span>${online.summary.shipping || 0}</span></div>
        <div class="row"><span>Delivered</span><span>${online.summary.delivered || 0}</span></div>
        <div class="row" style="color:#dc2626;"><span> Returned</span><span style="color:#dc2626;font-weight:700;">${online.summary.returned}</span></div>
        <div class="row" style="color:#16a34a;"><span> Grand Total Pieces</span><span style="color:#16a34a;font-weight:700;">${grandTotalPieces}</span></div>
        <div class="row" style="color:#dc2626;"><span> Return Pieces</span><span style="color:#dc2626;font-weight:700;">${returnPieces}</span></div>
        <div class="row" style="color:#2563eb;"><span> Total Pieces</span><span style="color:#2563eb;font-weight:700;">${totalPieces}</span></div>
      </div>
    </div>

    <!-- CITY BREAKDOWN -->
    <h2> City-wise Breakdown</h2>
    <table>
      <thead><tr>
        <th>#</th><th>City</th>
        <th style="text-align:center;">Orders</th>
        <th style="text-align:right;">Revenue</th>
        <th style="text-align:center;"> Returned</th>
        <th style="text-align:center;"> Net Orders</th>
      </tr></thead>
      <tbody>
        ${cityRows || '<tr><td colspan="6" style="text-align:center;color:#999;padding:12px;">No city data</td></tr>'}
        ${online.cityBreakdown && online.cityBreakdown.length > 0 ? `
        <tr class="total-row">
          <td colspan="2">TOTAL</td>
          <td style="text-align:center;">${online.summary.totalOrders}</td>
          <td style="text-align:right;">Rs ${online.summary.totalRevenue.toLocaleString()}</td>
          <td style="text-align:center;color:#dc2626;">${online.summary.returned}</td>
          <td style="text-align:center;color:#16a34a;">${online.summary.delivered || 0}</td>
        </tr>` : ''}
      </tbody>
    </table>

    <!-- ONLINE ORDERS LIST -->
    <h2> Online Orders Report</h2>
    <table>
      <thead><tr>
        <th>Customer Name</th>
        <th style="text-align:center;">Payment Method</th>
        <th>City</th>
        <th>Products & Qty</th>
        <th style="text-align:center;">Total Pieces</th>
        <th style="text-align:right;">Total Amount</th>
        <th style="text-align:center;">Order Status</th>
        <th>Order Date</th>
      </tr></thead>
      <tbody>
        ${onlineRows || '<tr><td colspan="8" style="text-align:center;color:#999;padding:12px;">No online orders</td></tr>'}
      </tbody>
    </table>

    <!-- ONLINE RETURNS SECTION -->
    <h2> ONLINE RETURNS</h2>
    <table>
      <thead><tr>
        <th>Return ID</th>
        <th style="text-align:center;">Date</th>
        <th style="text-align:center;">Pieces</th>
        <th style="text-align:right;">Amount</th>
        <th>Description</th>
        <th>User</th>
      </tr></thead>
      <tbody>
        ${returnsRows || '<tr><td colspan="6" style="text-align:center;color:#999;padding:12px;">No online returns</td></tr>'}
      </tbody>
    </table>

    <!-- WHOLESALE SALES LIST -->
    <h2> Wholesale Sales</h2>
    <table>
      <thead><tr>
        <th>Sale ID</th><th>Date</th>
        <th style="text-align:right;">Subtotal</th>
        <th style="text-align:right;">Discount</th>
        <th style="text-align:right;">Total</th>
        <th>Payment</th>
      </tr></thead>
      <tbody>
        ${wholesaleRows || '<tr><td colspan="6" style="text-align:center;color:#999;padding:12px;">No wholesale sales</td></tr>'}
      </tbody>
    </table>

    <!-- OFFLINE SALES LIST -->
    <h2> Offline Sales</h2>
    <table>
      <thead><tr>
        <th>Sale ID</th><th>Date</th>
        <th style="text-align:right;">Subtotal</th>
        <th style="text-align:right;">Discount</th>
        <th style="text-align:right;">Total</th>
        <th>Payment</th>
      </tr></thead>
      <tbody>
        ${offlineRows || '<tr><td colspan="6" style="text-align:center;color:#999;padding:12px;">No offline sales</td></tr>'}
      </tbody>
    </table>

    ${this.perfData && this.perfData.users && this.perfData.users.length > 0 ? `
    <h2> User Performance Summary</h2>
    <table>
      <thead><tr>
        <th>Username</th>
        <th style="text-align:center;">Delivered Orders</th>
        <th style="text-align:right;">Delivered Sales</th>
        <th style="text-align:center;">Delivered Pieces</th>
        <th style="text-align:center;"> Returns</th>
        <th style="text-align:right;"> Amount</th>
        <th style="text-align:right;">Net Sales</th>
      </tr></thead>
      <tbody>
        ${this.perfData.users.map(u => `
        <tr>
          <td style="font-weight:700;">${u.username}</td>
          <td style="text-align:center;">${u.deliveredOrders}</td>
          <td style="text-align:right;">Rs ${u.deliveredSales.toLocaleString()}</td>
          <td style="text-align:center;font-weight:700;">${u.deliveredPieces}</td>
          <td style="text-align:center;color:#dc2626;">${u.returnedOrders}</td>
          <td style="text-align:right;color:#dc2626;">Rs ${u.returnedAmount.toLocaleString()}</td>
          <td style="text-align:right;font-weight:800;">Rs ${u.netSales.toLocaleString()}</td>
        </tr>`).join('')}
      </tbody>
    </table>
    ${this.perfData.users.map(u => `
    <h3>User: ${u.username} — Delivered Orders</h3>
    <table>
      <thead><tr>
        <th>Order #</th><th>Customer</th><th>City</th><th>Date</th><th style="text-align:right;">Amount</th>
      </tr></thead>
      <tbody>
        ${(u.orders || []).map(o => `
        <tr>
          <td style="font-family:monospace;font-size:10px;">${o.orderId}</td>
          <td>${o.customer}</td>
          <td>${o.city}</td>
          <td style="font-size:10px;">${this.formatShortDate(o.date)}</td>
          <td style="text-align:right;font-weight:700;">Rs ${(o.amount || 0).toLocaleString()}</td>
        </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;color:#999;padding:12px;">No delivered orders</td></tr>'}
      </tbody>
    </table>`).join('')}` : ''}

    <div class="footer">
      Lajpal Brand Hub &bull; Report generated ${new Date().toLocaleString('en-PK')} &bull; www.lajpalbrandhub.com<br>
      Software Developed by Nanogramics<br>nanogramics.tech
    </div>

    <script>window.onload = function() { window.print(); };<\/script>
    ${this.buildAdjustmentsHTML(true)}
    </body></html>`;

    const win = window.open('', '_blank', 'width=900,height=700,menubar=yes,toolbar=yes');
    if (!win) { showToast('Please allow popups for PDF', 'error'); return; }
    win.document.write(html);
    win.document.close();
    showToast('PDF ready — use browser Print → Save as PDF', 'success');
  }

  // ── DOWNLOAD CSV ──────────────────────────────────────────────
  downloadCSV() {
    if (!this.fullData) { showToast('Generate report first', 'warning'); return; }
    const { offline, online, combined, wholesale } = this.fullData;
    const period = `${this.startDate} to ${this.endDate}`;

    // Use the new piece calculations from the backend
    const grandTotalPieces = online.summary.grandTotalPieces || 0;
    const returnPieces = online.summary.returnPieces || 0;
    const totalPieces = online.summary.totalPieces || 0;
    const netOnlineRevenue = online.summary.netOnlineRevenue || 0;

    let csv = `LAJPAL BRAND HUB - FULL REPORT\nPeriod:,${period}\nGenerated:,${new Date().toLocaleString()}\n\n`;
    csv += `COMBINED SUMMARY\nTotal Revenue,Rs ${combined.totalRevenue}\nTotal Transactions,${combined.totalTransactions}\nGrand Total Pieces,${grandTotalPieces}\nReturn Pieces,${returnPieces}\nTotal Pieces,${totalPieces}\n\n`;

    csv += `OFFLINE SUMMARY\nSales,${offline.summary.totalSales}\nRevenue,Rs ${offline.summary.totalRevenue}\nDiscount,Rs ${offline.summary.totalDiscount}\nItems Sold,${offline.summary.totalItems}\n\n`;

    csv += `ONLINE SUMMARY\nOrders,${online.summary.totalOrders}\nGross Revenue,Rs ${online.summary.totalRevenue}\nNet Revenue,Rs ${netOnlineRevenue}\nPaid,${online.summary.paid}\nCOD,${online.summary.cod}\nDelivered,${online.summary.delivered}\nShipping,${online.summary.shipping}\nReturned,${online.summary.returned}\nGrand Total Pieces,${grandTotalPieces}\nReturn Pieces,${returnPieces}\nTotal Pieces,${totalPieces}\n\n`;

    csv += `CITY BREAKDOWN\nCity,Orders,Revenue,Returned,Net Orders\n`;
    (online.cityBreakdown || []).forEach(c => {
      csv += `"${c.city}",${c.orders},"Rs ${c.revenue}",${c.returned},${c.orders - c.returned}\n`;
    });

    // Online orders with NEW COLUMN STRUCTURE
    csv += `\nONLINE ORDERS\nCustomer Name,Payment Method,City,Products & Qty,Total Pieces,Total Amount,Order Status,Order Date\n`;
    (online.orders || []).forEach(o => {
      const isPaid = o.payment_status === 'paid';
      const totalPieces = this.calculateTotalPieces(o.items);
      const productsList = this.formatProductsWithBullets(o.items).replace(/<br>/g, ' | ');
      const orderDate = this.formatOrderDate(o.created_at);
      csv += `"${o.customer_name||''}","${isPaid?'Paid':'COD'}","${o.city||''}","${productsList}","${totalPieces}","Rs ${o.total||0}","${o.order_status||''}","${orderDate}"\n`;
    });

    // Online Returns section
    const simpleReturns = online.simpleReturns || [];
    csv += `\nONLINE RETURNS\nReturn ID,Date,Pieces,Amount,Description,User\n`;
    simpleReturns.forEach(r => {
      const returnDate = r.created_at ? r.created_at.split('T')[0] : '';
      csv += `"${r.id}","${returnDate}","${r.return_pieces || 0}","Rs ${r.return_amount || 0}","${r.description || ''}","${r.username || ''}"\n`;
    });

    csv += `\nOFFLINE SALES\nSale ID,Date,Subtotal,Discount,Total,Payment\n`;
    (offline.sales || []).forEach(s => {
      csv += `"${s.id}","${(s.created_at||'').split('T')[0]}","Rs ${s.subtotal||0}","Rs ${s.discount||0}","Rs ${s.total||0}","${s.payment_method||''}"\n`;
    });

    csv += '\nADJUSTED REVENUE\nNet revenue after returns and exchanges,' + (combined.netRevenue ?? combined.totalRevenue) + '\n';
    csv += this.adjustmentCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lajpal_report_${this.startDate}_${this.endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast('CSV downloaded', 'success');
  }

  // ── EVENT LISTENERS ───────────────────────────────────────────
  setupEventListeners() {
    if (this.listenersBound) return;
    this.listenersBound = true;
    document.getElementById('btn-generate-report')
      ?.addEventListener('click', () => this.generateReport());
    document.getElementById('btn-download-report')
      ?.addEventListener('click', () => this.downloadCSV());
    document.getElementById('btn-weekly-report')
      ?.addEventListener('click', () => this.setWeekly());
    document.getElementById('btn-monthly-report')
      ?.addEventListener('click', () => this.setMonthly());
    document.getElementById('btn-pdf-report')
      ?.addEventListener('click', () => this.downloadPDF());
  }
}

const reports = new ReportsManager();
