/**
 * ONLINE ORDERS MODULE
 * - City-based Order IDs (KHI225, ISL445 format)
 * - City dropdown (hardcoded in HTML, reset-safe)
 * - Order status: pending / shipping / delivered
 * - Admin-only delete
 * - Search, filter tabs, city filter
 * - Product multi-select from inventory (searchable, qty per product)
 * - Fixed: Duplicate order submission prevention (CLEAN VERSION)
 * - BULK ACTIONS: Multi-select with bulk status updates
 */

// ── PAKISTAN CITIES MAP ───────────────────────────────────────
const PAKISTAN_CITIES = {
  'Karachi':'KHI','Lahore':'LHR','Islamabad':'ISL','Rawalpindi':'RWP',
  'Faisalabad':'FSL','Multan':'MLT','Peshawar':'PSH','Quetta':'QTA',
  'Sialkot':'SKT','Gujranwala':'GWL','Hyderabad':'HYD','Bahawalpur':'BWP',
  'Sargodha':'SGD','Sukkur':'SKR','Larkana':'LRK','Sheikhupura':'SHK',
  'Rahimyar Khan':'RYK','Jhang':'JHG','Dera Ghazi Khan':'DGK','Gujrat':'GJT',
  'Abbottabad':'ABT','Mardan':'MRD','Kasur':'KSR','Nawabshah':'NWS',
  'Mingora':'MNG','Chiniot':'CHN','Kamoke':'KMK','Hafizabad':'HFZ',
  'Sadiqabad':'SDB','Mirpur Khas':'MPK','Okara':'OKR','Mandi Bahauddin':'MBD',
  'Jacobabad':'JCB','Shikarpur':'SKP','Khanewal':'KNW','Muzaffargarh':'MZG',
  'Khanpur':'KNP','Ghotki':'GHK','Hasilpur':'HSP','Other':'OTH',
};

// ── CITY-BASED ORDER ID ───────────────────────────────────────
function generateCityOrderId(cityName) {
  const code = PAKISTAN_CITIES[cityName] || 'OTH';
  const num  = Math.floor(100 + Math.random() * 900);
  return `${code}${num}`;
}

// ── ORDER STATUS CONFIG ───────────────────────────────────────
const ORDER_STATUS = {
  pending:   { label: 'Pending',   icon: '🕐', color: '#f59e0b' },
  shipping:  { label: 'Shipping',  icon: '🚚', color: '#3b82f6' },
  delivered: { label: 'Delivered', icon: '✅', color: '#22c55e' },
  return:    { label: 'Returned',  icon: '↩️', color: '#ef4444' },
};

class OnlineOrdersManager {
  constructor() {
    this.orders         = [];
    this.filteredOrders = [];
    this.products       = [];
    this.selectedProducts = {};
    this.productSearch  = '';
    this.currentDate    = getTodayDate();
    this.activeFilter   = 'date';
    this.activeCity     = '';
    this.searchTerm     = '';
    this.submittedOrderIds = new Set();
    this.selectedOrders = new Set(); // ── BULK ACTIONS: Track selected order IDs
  }

  // ── INIT ─────────────────────────────────────────────────────
  async init() {
    try {
      await Promise.all([this.loadOrders(), this.loadProducts()]);
      this.setupEventListeners();
      this.updateDateDisplay();
      this.applyFilter();
    } catch (err) {
      console.error('Online orders init failed:', err);
      showToast('Failed to load orders', 'error');
    }
  }

  async loadProducts() {
    try {
      this.products = await API.getProducts();
    } catch (err) {
      console.error('Failed to load products:', err);
      this.products = [];
    }
  }

  resetProductSelection() {
    this.selectedProducts = {};
    this.productSearch = '';
    const searchEl = document.getElementById('online-product-search');
    if (searchEl) searchEl.value = '';
    this.renderProductPicker();
    this.updateOrderTotalsFromProducts();
  }

  getFilteredProducts() {
    const q = this.productSearch.trim().toLowerCase();
    if (!q) return this.products;
    return this.products.filter(p =>
      (p.name && p.name.toLowerCase().includes(q)) ||
      (p.code && p.code.toLowerCase().includes(q)) ||
      (p.sku && p.sku.toLowerCase().includes(q)) ||
      (p.article_code && p.article_code.toLowerCase().includes(q)) ||
      (p.price && String(p.price).includes(q))
    );
  }

  renderProductPicker() {
    const pickerEl = document.getElementById('online-product-picker');
    if (!pickerEl) return;

    const products = this.getFilteredProducts();
    if (products.length === 0) {
      pickerEl.innerHTML = '<div style="padding:12px;text-align:center;color:var(--muted);font-size:13px;">No products found</div>';
      return;
    }

    pickerEl.innerHTML = products.map(product => {
      const selected = this.selectedProducts[product.code];
      const checked  = !!selected;
      const qty      = selected ? selected.qty : 1;
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 6px;border-bottom:1px solid #1f2230;">
          <input type="checkbox" id="online-prod-${product.code}"
            ${checked ? 'checked' : ''}
            onchange="online.toggleProduct('${product.code}', this.checked)"
            style="width:16px;height:16px;cursor:pointer;">
          <label for="online-prod-${product.code}" style="flex:1;cursor:pointer;min-width:0;">
            <div style="font-weight:600;font-size:13px;">${product.name}</div>
            <div style="font-size:11px;color:var(--muted);">${product.code} · Rs ${formatCurrency(product.price)}</div>
          </label>
          <input type="number" min="1" value="${qty}"
            ${checked ? '' : 'disabled'}
            onchange="online.setProductQty('${product.code}', this.value)"
            onclick="event.stopPropagation()"
            style="width:64px;height:34px;border-radius:8px;border:1px solid #333;background:#0d0f16;color:#fff;text-align:center;font-family:'Outfit',sans-serif;">
        </div>
      `;
    }).join('');
  }

  toggleProduct(code, isChecked) {
    const product = this.products.find(p => p.code === code);
    if (!product) return;

    if (isChecked) {
      this.selectedProducts[code] = {
        id:    product.id,
        code:  product.code,
        name:  product.name,
        price: Number(product.price) || 0,
        qty:   this.selectedProducts[code]?.qty || 1,
      };
    } else {
      delete this.selectedProducts[code];
    }

    this.renderProductPicker();
    this.updateOrderTotalsFromProducts();
  }

  setProductQty(code, qty) {
    const parsed = parseInt(qty, 10);
    if (!this.selectedProducts[code]) return;
    this.selectedProducts[code].qty = parsed > 0 ? parsed : 1;
    this.updateOrderTotalsFromProducts();
  }

  buildSelectedItems() {
    return Object.values(this.selectedProducts).map(item => ({
      id:    item.id,
      code:  item.code,
      name:  item.name,
      price: item.price,
      qty:   item.qty,
    }));
  }

  updateOrderTotalsFromProducts() {
    const items = this.buildSelectedItems();
    const subtotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const totalEl = document.getElementById('online-total');
    if (totalEl && items.length > 0) {
      totalEl.value = subtotal;
    }
  }

  // ── LOAD ──────────────────────────────────────────────────────
  async loadOrders() {
    try {
      this.orders = await API.getOnlineOrders();
      this.orders.forEach(o => this.submittedOrderIds.add(o.id));
    } catch (err) {
      console.error('Failed to load orders:', err);
      showToast('Failed to load orders', 'error');
    }
  }

  // ── APPLY FILTER ──────────────────────────────────────────────
  applyFilter() {
    let result = [...this.orders];

    switch (this.activeFilter) {
      case 'date':
        result = result.filter(o => (o.created_at || '').startsWith(this.currentDate));
        break;
      case 'cod':
        result = result.filter(o => (o.payment_status || o.paymentStatus) !== 'paid');
        break;
      case 'paid':
        result = result.filter(o => (o.payment_status || o.paymentStatus) === 'paid');
        break;
      case 'city':
        if (this.activeCity) result = result.filter(o => (o.city || '') === this.activeCity);
        break;
      case 'pending':
        result = result.filter(o => (o.order_status || 'pending') === 'pending');
        break;
      case 'shipping':
        result = result.filter(o => o.order_status === 'shipping');
        break;
      case 'delivered':
        result = result.filter(o => o.order_status === 'delivered');
        break;
      case 'return':
        result = result.filter(o => o.order_status === 'return');
        break;
    }

    if (this.searchTerm.trim()) {
      const q = this.searchTerm.trim().toLowerCase();
      result = result.filter(o => {
        const id    = (o.id || '').toLowerCase();
        const name  = (o.customer_name || '').toLowerCase();
        const phone = (o.customer_phone || '').toLowerCase();
        const city  = (o.city || '').toLowerCase();
        return id.includes(q) || name.includes(q) || phone.includes(q) || city.includes(q);
      });
    }

    this.filteredOrders = result;
    this.render();
    this.updateStats();
    this.updateCityFilterCounts();
  }

  // ── UPDATE CITY FILTER COUNTS ─────────────────────────────────
  updateCityFilterCounts() {
    const sel = document.getElementById('online-city-filter');
    if (!sel) return;
    const saved = sel.value;
    Array.from(sel.options).forEach(opt => {
      if (!opt.value) {
        opt.textContent = `🌍 All Cities (${this.orders.length})`;
        return;
      }
      const count = this.orders.filter(o => o.city === opt.value).length;
      const code  = PAKISTAN_CITIES[opt.value] || 'OTH';
      opt.textContent = count > 0
        ? `📍 ${opt.value} (${code}) — ${count}`
        : `${opt.value} (${code})`;
    });
    sel.value = saved;
  }

  // ── CREATE ORDER ──────────────────────────────────────────────
  async createOrder(orderData) {
    try {
      if (!orderData.customer?.name)  throw new Error('Customer name is required');
      if (!orderData.customer?.phone) throw new Error('Customer phone is required');
      if (!orderData.customer?.city)  throw new Error('Please select a city');

      const items = orderData.items || [];
      if (items.length === 0) throw new Error('Please select at least one product');

      let orderId, attempts = 0;
      do {
        orderId = generateCityOrderId(orderData.customer.city);
        attempts++;
      } while (this.submittedOrderIds.has(orderId) && attempts < 50);

      if (this.submittedOrderIds.has(orderId)) {
        throw new Error('Failed to generate unique order ID. Please try again.');
      }

      const currentUser = auth.getCurrentUser() || {};
      const itemSubtotal = items.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0);
      const delivery = Number(orderData.delivery) || 0;
      const discount = Number(orderData.discount) || 0;
      const subtotal = Number(orderData.subtotal) || itemSubtotal;
      const total    = Number(orderData.total)    || Math.max(0, subtotal + delivery - discount);

      const order = {
        id:            orderId,
        customer:      orderData.customer,
        city:          orderData.customer.city,
        items,
        subtotal,
        delivery,
        discount,
        total,
        paymentStatus: orderData.paymentStatus     || 'cod',
        orderStatus:   'pending',
        notes:         orderData.notes             || '',
        weight:        Number(orderData.weight)    || 0,
        userId:        currentUser.id              || 0,
        username:      currentUser.username        || '',
        createdBy:     currentUser.username        || '',
        created_at:    getCurrentTimestamp()
      };

      const existingOrders = await API.getOnlineOrders();
      if (existingOrders.some(o => o.id === orderId)) {
        throw new Error(`Order ID ${orderId} already exists. Please try again.`);
      }

      await API.createOnlineOrder(order);
      this.submittedOrderIds.add(orderId);
      await this.loadOrders();
      this.applyFilter();
      
      showToast(`✅ Order saved: #${orderId}`, 'success');
      return orderId;

    } catch (err) {
      console.error('createOrder failed:', err);
      showToast(err.message || 'Failed to save order', 'error');
      throw err;
    }
  }

  // ── UPDATE STATUS ─────────────────────────────────────────────
  async updateOrderStatus(orderId, newStatus) {
    try {
      await API.updateOnlineOrderStatus(orderId, newStatus);
      await this.loadOrders();
      this.applyFilter();
      showToast(`Order #${orderId} → ${ORDER_STATUS[newStatus]?.label || newStatus}`, 'success');
    } catch (err) {
      console.error('updateOrderStatus failed:', err);
      showToast(err.message || 'Failed to update status', 'error');
    }
  }

  // ── DELETE ORDER (admin only) ─────────────────────────────────
  async deleteOrder(orderId) {
    const user = auth.getCurrentUser();
    if (!user || user.role !== 'admin') {
      showToast('Only admin can delete orders', 'error');
      return;
    }
    if (!confirm(`Delete order #${orderId}? This cannot be undone.`)) return;
    try {
      await API.deleteOnlineOrder(orderId);
      this.submittedOrderIds.delete(orderId);
      await this.loadOrders();
      this.applyFilter();
      showToast(`Order #${orderId} deleted`, 'success');
    } catch (err) {
      console.error('deleteOrder failed:', err);
      showToast('Failed to delete order', 'error');
    }
  }

  // ── BULK ACTIONS ──────────────────────────────────────────────

  // Toggle individual order selection
  toggleOrderSelection(orderId, isChecked) {
    if (isChecked) {
      this.selectedOrders.add(orderId);
    } else {
      this.selectedOrders.delete(orderId);
    }
    this.updateBulkActionsToolbar();
    this.updateSelectAllCheckbox();
  }

  // Toggle select all orders
  toggleSelectAll(isChecked) {
    if (isChecked) {
      this.filteredOrders.forEach(order => this.selectedOrders.add(order.id));
    } else {
      this.selectedOrders.clear();
    }
    this.updateBulkActionsToolbar();
    this.render(); // Re-render to update individual checkboxes
  }

  // Update the bulk actions toolbar visibility and count
  updateBulkActionsToolbar() {
    const toolbar = document.getElementById('bulk-actions-toolbar');
    const countEl = document.getElementById('bulk-selected-count');
    
    if (!toolbar || !countEl) return;
    
    const count = this.selectedOrders.size;
    countEl.textContent = count;
    
    if (count > 0) {
      toolbar.style.display = 'flex';
    } else {
      toolbar.style.display = 'none';
    }
  }

  // Update the select all checkbox state
  updateSelectAllCheckbox() {
    const selectAllEl = document.getElementById('select-all-orders');
    if (!selectAllEl) return;
    
    const visibleOrders = this.filteredOrders;
    const allSelected = visibleOrders.length > 0 && 
      visibleOrders.every(order => this.selectedOrders.has(order.id));
    const anySelected = visibleOrders.some(order => this.selectedOrders.has(order.id));
    
    selectAllEl.checked = allSelected;
    selectAllEl.indeterminate = !allSelected && anySelected;
  }

  // Get selected orders that are not already in target status
  getOrdersToUpdate(targetStatus) {
    return this.filteredOrders.filter(order => 
      this.selectedOrders.has(order.id) && 
      (order.order_status || 'pending') !== targetStatus
    );
  }

  // Show confirmation dialog for bulk action
  async showBulkActionConfirmation(status, count) {
    const statusLabel = ORDER_STATUS[status]?.label || status;
    const result = await API.showMessageBox({
      type: 'question',
      title: 'Confirm Bulk Action',
      message: `You are about to mark ${count} selected orders as ${statusLabel}.`,
      buttons: ['Cancel', 'Confirm'],
      defaultId: 0,
      cancelId: 0
    });
    return result.response === 1; // Returns true if Confirm clicked
  }

  // Bulk update order status
  async bulkUpdateStatus(status) {
    const ordersToUpdate = this.getOrdersToUpdate(status);
    const alreadyInStatus = this.selectedOrders.size - ordersToUpdate.length;
    
    if (ordersToUpdate.length === 0) {
      if (alreadyInStatus > 0) {
        showToast(`All selected orders are already ${ORDER_STATUS[status]?.label || status}`, 'info');
      }
      this.clearSelection();
      return;
    }

    // Show confirmation dialog
    const confirmed = await this.showBulkActionConfirmation(status, ordersToUpdate.length);
    if (!confirmed) return;

    try {
      // Use bulk API to update all orders in a single transaction
      const orderIds = ordersToUpdate.map(o => o.id);
      const result = await API.bulkUpdateOnlineOrderStatus(orderIds, status);
      
      // Clear selection after successful update
      this.clearSelection();
      
      // Reload orders and refresh UI
      await this.loadOrders();
      this.applyFilter();
      
      // Refresh dashboard statistics, reports, and user performance
      this.refreshAllData();
      
      // Show success message
      let message = `${ordersToUpdate.length} order${ordersToUpdate.length !== 1 ? 's' : ''} successfully marked as ${ORDER_STATUS[status]?.label || status}.`;
      if (alreadyInStatus > 0) {
        message += ` ${alreadyInStatus} order${alreadyInStatus !== 1 ? 's' : ''} were already ${ORDER_STATUS[status]?.label || status}.`;
      }
      showToast(message, 'success');
      
    } catch (err) {
      console.error('bulkUpdateStatus failed:', err);
      showToast(err.message || 'Failed to update orders', 'error');
    }
  }

  // Clear all selections
  clearSelection() {
    this.selectedOrders.clear();
    this.updateBulkActionsToolbar();
    this.render();
  }

  // Refresh all related data (dashboard, reports, user performance)
  async refreshAllData() {
    // Refresh reports if on reports tab
    if (typeof reports !== 'undefined' && reports.refreshCurrentReport) {
      reports.refreshCurrentReport();
    }
  }

  // ── RENDER ────────────────────────────────────────────────────
  render() {
    const listEl = document.getElementById('online-orders-list');
    if (!listEl) return;

    const user    = auth.getCurrentUser();
    const isAdmin = user && user.role === 'admin';

    if (this.filteredOrders.length === 0) {
      const msg = this.searchTerm
        ? `No orders found for "${this.searchTerm}"`
        : this.activeFilter === 'date' ? 'No orders on this date' : 'No orders found';
      listEl.innerHTML = `<div class="empty-state"><p>${msg}</p></div>`;
      return;
    }

    // Check if all visible orders are selected
    const allSelected = this.filteredOrders.length > 0 && 
      this.filteredOrders.every(order => this.selectedOrders.has(order.id));
    const anySelected = this.filteredOrders.some(order => this.selectedOrders.has(order.id));

    listEl.innerHTML = `
      <div class="bulk-actions-header" style="display:flex;align-items:center;gap:10px;padding:8px 0;margin-bottom:8px;border-bottom:1px solid var(--border);">
        <input type="checkbox" id="select-all-orders" 
          ${allSelected ? 'checked' : ''} 
          onchange="online.toggleSelectAll(this.checked)"
          style="width:18px;height:18px;cursor:pointer;">
        <span style="font-size:13px;color:var(--muted);font-weight:600;">Select All</span>
      </div>
      ${[...this.filteredOrders].reverse().map(order => {
        const timeStr   = formatTime(order.created_at);
        const dateStr   = formatDate(order.created_at);
        const isPaid    = (order.payment_status || order.paymentStatus) === 'paid';
        const items     = order.items || [];
        const itemsTxt  = items.length > 0
          ? items.map(i => `${i.qty || 1} x ${i.name || i.code || ''}`).join(', ')
          : '—';
        const custName  = order.customer_name  || '';
        const custPhone = order.customer_phone || '';
        const custAddr  = order.customer_address || '';
        const city      = order.city || '';
        const cityCode  = PAKISTAN_CITIES[city] || '';
        const weight    = order.weight || 0;
        const oStatus   = order.order_status || 'pending';
        const sCfg      = ORDER_STATUS[oStatus] || ORDER_STATUS.pending;
        const isSelected = this.selectedOrders.has(order.id);

        const statusOpts = Object.entries(ORDER_STATUS).map(([key, cfg]) =>
          `<option value="${key}" ${oStatus === key ? 'selected' : ''}>${cfg.icon} ${cfg.label}</option>`
        ).join('');

        return `
          <div class="online-order-row">
            <div class="oor-header">
              <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0;">
                <input type="checkbox" 
                  ${isSelected ? 'checked' : ''}
                  onchange="online.toggleOrderSelection('${order.id}', this.checked)"
                  style="width:18px;height:18px;cursor:pointer;flex-shrink:0;">
                <div style="flex:1;min-width:0;">
                  <div class="oor-id">
                    <span class="oor-num">#${order.id}</span>
                    <span class="oor-status ${isPaid ? 'paid' : 'cod'}">${isPaid ? 'PAID' : 'COD'}</span>
                    ${city ? `<span style="background:#1e2a1e;color:#86efac;font-size:11px;padding:2px 7px;border-radius:10px;font-weight:700;">${cityCode || city}</span>` : ''}
                    <span class="oor-date-badge">${dateStr} · ${timeStr}</span>
                  </div>
                  <div class="oor-name">${custName}</div>
                  <div class="oor-meta">${custPhone}${custAddr ? ' · ' + custAddr : ''}${city ? ' · 📍 ' + city : ''}</div>
                  ${weight > 0 ? `<div class="oor-meta">⚖ <strong>${weight} kg</strong></div>` : ''}
                  ${order.notes ? `<div class="oor-meta" style="font-style:italic;color:var(--yellow);">📝 ${order.notes}</div>` : ''}
                  ${itemsTxt !== '—' ? `<div class="oor-meta" style="margin-top:3px;">📦 ${itemsTxt}</div>` : ''}
                  <div style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <span style="color:${sCfg.color};font-weight:600;font-size:13px;">${sCfg.icon} ${sCfg.label}</span>
                    <select onchange="online.updateOrderStatus('${order.id}', this.value)"
                      style="background:#11131b;color:#fff;border:1px solid #333;border-radius:8px;padding:4px 8px;font-size:12px;cursor:pointer;font-family:'Outfit',sans-serif;">
                      ${statusOpts}
                    </select>
                  </div>
                </div>
              </div>
              <div style="text-align:right;display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0;">
                <div class="oor-total">Rs ${formatCurrency(order.total || 0)}</div>
                <button class="action-btn" onclick="online.printOrderReceipt('${order.id}')">🖨️ Print</button>
                <button class="action-btn" onclick="online.editOrder('${order.id}')"
                  style="background:#1e2a1e;color:#86efac;border:none;padding:5px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif;">
                  ✏️ Edit
                </button>
                ${isAdmin ? `<button onclick="online.deleteOrder('${order.id}')"
                  style="background:#7f1d1d;color:#fca5a5;border:none;padding:5px 12px;border-radius:8px;cursor:pointer;font-size:12px;font-family:'Outfit',sans-serif;">
                  🗑️ Delete
                </button>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}
    `;

    // Update select all checkbox state
    this.updateSelectAllCheckbox();
  }

  // ── STATS ─────────────────────────────────────────────────────
  updateStats() {
    const statsEl = document.getElementById('online-stats');
    if (!statsEl) return;
    const totalRev  = this.filteredOrders.reduce((s, o) => s + (o.total || 0), 0);
    const paidCount = this.filteredOrders.filter(o => (o.payment_status || o.paymentStatus) === 'paid').length;
    const codCount  = this.filteredOrders.length - paidCount;
    const pendCount = this.filteredOrders.filter(o => (o.order_status || 'pending') === 'pending').length;
    const shipCount = this.filteredOrders.filter(o => o.order_status === 'shipping').length;
    const delCount    = this.filteredOrders.filter(o => o.order_status === 'delivered').length;
    const retCount    = this.orders.filter(o => o.order_status === 'return').length;

    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">Revenue</div><div class="stat-value gold">Rs ${formatCurrency(totalRev)}</div></div>
      <div class="stat-card"><div class="stat-label">Orders</div><div class="stat-value">${this.filteredOrders.length}</div></div>
      <div class="stat-card"><div class="stat-label">Paid</div><div class="stat-value green">${paidCount}</div></div>
      <div class="stat-card"><div class="stat-label">COD</div><div class="stat-value" style="color:var(--yellow);">${codCount}</div></div>
      <div class="stat-card"><div class="stat-label">🕐 Pending</div><div class="stat-value" style="color:#f59e0b;">${pendCount}</div></div>
      <div class="stat-card"><div class="stat-label">🚚 Shipping</div><div class="stat-value" style="color:#3b82f6;">${shipCount}</div></div>
      <div class="stat-card"><div class="stat-label">✅ Delivered</div><div class="stat-value" style="color:#22c55e;">${delCount}</div></div>
      <div class="stat-card" style="border-color:#7f1d1d;"><div class="stat-label">↩️ Returned</div><div class="stat-value" style="color:#ef4444;">${retCount}</div></div>
    `;
  }

  // ── DATE DISPLAY ──────────────────────────────────────────────
  updateDateDisplay() {
    const dateEl = document.getElementById('online-report-date');
    if (!dateEl) return;
    dateEl.value = this.currentDate;
    dateEl.addEventListener('change', e => {
      this.currentDate = e.target.value;
      if (this.activeFilter === 'date') this.applyFilter();
    });
  }

  // ── UPDATE PAYMENT STATUS OPTIONS ─────────────────────────────────
  updatePaymentStatusOptions(selectedCity) {
    const payEl = document.getElementById('online-payment-status');
    if (!payEl) return;

    // Only Karachi can have COD, all other cities must be PAID
    if (selectedCity && selectedCity !== 'Karachi') {
      payEl.value = 'paid';
      payEl.disabled = true;
    } else {
      payEl.disabled = false;
    }
  }

  // ── OPEN FORM ─────────────────────────────────────────────────
  openNewOrderForm() {
    this.editingOrderId = null;
    const form = document.getElementById('online-order-form');
    if (form) {
      form.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), textarea').forEach(el => {
        if (el.id !== 'online-delivery' && el.id !== 'online-discount') el.value = '';
      });
      const payEl = document.getElementById('online-payment-status');
      if (payEl) {
        payEl.value = 'cod';
        payEl.disabled = false;
      }
      const cityEl = document.getElementById('online-city');
      if (cityEl) cityEl.value = '';
      const deliveryEl = document.getElementById('online-delivery');
      if (deliveryEl) deliveryEl.value = '0';
      const discountEl = document.getElementById('online-discount');
      if (discountEl) discountEl.value = '0';
    }
    this.resetProductSelection();
    showModal('modal-online-order');
  }

  // ── EDIT ORDER ───────────────────────────────────────────────
  editOrder(orderId) {
    const order = this.orders.find(o => o.id === orderId);
    if (!order) { showToast('Order not found', 'error'); return; }

    this.editingOrderId = orderId;
    this.editingOrderStatus = order.order_status || 'pending';

    // Pre-fill form with existing data
    const form = document.getElementById('online-order-form');
    if (form) {
      const nameEl = document.getElementById('online-customer-name');
      if (nameEl) nameEl.value = order.customer_name || '';
      const phoneEl = document.getElementById('online-customer-phone');
      if (phoneEl) phoneEl.value = order.customer_phone || '';
      const addressEl = document.getElementById('online-customer-address');
      if (addressEl) addressEl.value = order.customer_address || '';
      const cityEl = document.getElementById('online-city');
      if (cityEl) cityEl.value = order.city || '';
      const payEl = document.getElementById('online-payment-status');
      if (payEl) payEl.value = order.payment_status || 'cod';
      const weightEl = document.getElementById('online-weight');
      if (weightEl) weightEl.value = order.weight || 0;
      const notesEl = document.getElementById('online-notes');
      if (notesEl) notesEl.value = order.notes || '';
      const deliveryEl = document.getElementById('online-delivery');
      if (deliveryEl) deliveryEl.value = order.delivery || 0;
      const discountEl = document.getElementById('online-discount');
      if (discountEl) discountEl.value = order.discount || 0;
      const totalEl = document.getElementById('online-total');
      if (totalEl) totalEl.value = order.total || 0;
    }

    // Pre-select products
    this.selectedProducts = {};
    const items = order.items || [];
    items.forEach(item => {
      this.selectedProducts[item.code] = {
        id:    item.id || item.code,
        code:  item.code,
        name:  item.name,
        price: Number(item.price) || 0,
        qty:   Number(item.qty) || 1,
      };
    });
    this.renderProductPicker();
    this.updateOrderTotalsFromProducts();

    // Update modal title and button text for editing
    const modalTitle = document.querySelector('#modal-online-order .modal-header h3');
    if (modalTitle) modalTitle.textContent = 'Edit Online Order';
    const submitBtn = document.querySelector('#online-order-form button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Update Order';

    showModal('modal-online-order');
  }

  // ── UPDATE ORDER ─────────────────────────────────────────────
  async updateOrder(orderData) {
    try {
      const orderId = this.editingOrderId;
      if (!orderId) throw new Error('No order selected for editing');

      const items = orderData.items || [];
      if (items.length === 0) throw new Error('Please select at least one product');

      const itemSubtotal = items.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0);
      const delivery = Number(orderData.delivery) || 0;
      const discount = Number(orderData.discount) || 0;
      const subtotal = Number(orderData.subtotal) || itemSubtotal;
      const total = Number(orderData.total) || Math.max(0, subtotal + delivery - discount);

      const order = {
        id:            orderId,
        customer:      orderData.customer,
        city:          orderData.customer.city,
        items,
        subtotal,
        delivery,
        discount,
        total,
        paymentStatus: orderData.paymentStatus || 'cod',
        orderStatus:   orderData.orderStatus || 'pending',
        notes:         orderData.notes || '',
        weight:        Number(orderData.weight) || 0,
      };

      await API.updateOnlineOrder(order);
      this.editingOrderId = null;
      await this.loadOrders();
      this.applyFilter();
      showToast(`✅ Order updated: #${orderId}`, 'success');
      return orderId;

    } catch (err) {
      console.error('updateOrder failed:', err);
      showToast(err.message || 'Failed to update order', 'error');
      throw err;
    }
  }

  // ── FORM SUBMIT ───────────────────────────────────────────────
  async handleOrderFormSubmit(event) {
    event.preventDefault();
    event.stopPropagation();

    const btn = event.target.querySelector('button[type="submit"]');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ Saving...';
    }

    try {
      const name      = document.getElementById('online-customer-name').value.trim();
      const phone     = document.getElementById('online-customer-phone').value.trim();
      const address   = document.getElementById('online-customer-address').value.trim();
      const city      = document.getElementById('online-city').value;
      const total     = parseFloat(document.getElementById('online-total').value)    || 0;
      const delivery  = parseFloat(document.getElementById('online-delivery').value) || 0;
      const discount  = parseFloat(document.getElementById('online-discount').value) || 0;
      const weight    = parseFloat(document.getElementById('online-weight').value)   || 0;
      const notes     = document.getElementById('online-notes').value.trim();
      const payStatus = document.getElementById('online-payment-status').value || 'cod';
      const items     = this.buildSelectedItems();

      if (!name)  throw new Error('Customer name is required');
      if (!phone) throw new Error('Customer phone is required');
      if (!city)  throw new Error('Please select a city');
      if (items.length === 0) throw new Error('Please select at least one product');

      const itemSubtotal = items.reduce((sum, item) => sum + (item.price * item.qty), 0);
      const subtotal = total > 0 ? total : itemSubtotal;
      const finalTotal = Math.max(0, subtotal + delivery - discount);

      // Check if we're editing an existing order
      if (this.editingOrderId) {
        const orderId = await this.updateOrder({
          customer:      { name, phone, address, city },
          items,
          subtotal,
          delivery,
          discount,
          total:         finalTotal,
          paymentStatus: payStatus,
          orderStatus:   this.editingOrderStatus || 'pending',
          notes,
          weight,
        });

        if (orderId) {
          // Reset modal title and button text
          const modalTitle = document.querySelector('#modal-online-order .modal-header h3');
          if (modalTitle) modalTitle.textContent = 'New Online Order';
          hideModal('modal-online-order');
          this.resetProductSelection();
        }
      } else {
        const orderId = await this.createOrder({
          customer:      { name, phone, address, city },
          items,
          subtotal,
          delivery,
          discount,
          total:         finalTotal,
          paymentStatus: payStatus,
          notes,
          weight,
        });

        if (orderId) {
          hideModal('modal-online-order');
          const form = document.getElementById('online-order-form');
          if (form) {
            form.querySelectorAll('input:not([type=hidden]):not([type=checkbox]), textarea').forEach(el => {
              if (el.id !== 'online-delivery' && el.id !== 'online-discount') el.value = '';
            });
            const payEl = document.getElementById('online-payment-status');
            if (payEl) payEl.value = 'cod';
            const cityEl = document.getElementById('online-city');
            if (cityEl) cityEl.value = '';
            const deliveryEl = document.getElementById('online-delivery');
            if (deliveryEl) deliveryEl.value = '0';
            const discountEl = document.getElementById('online-discount');
            if (discountEl) discountEl.value = '0';
          }
          this.resetProductSelection();
        }
      }
    } catch (err) {
      showToast(err.message || 'Failed to save order', 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = 'Create Order';
      }
    }
  }

  // ── PRINT RECEIPT ─────────────────────────────────────────────
  async printOrderReceipt(orderId) {
    const order = this.orders.find(o => o.id === orderId);
    if (!order) { showToast('Order not found', 'error'); return; }

    const now     = new Date(order.created_at);
    const date    = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const time    = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });
    const weight  = parseFloat(order.weight) || 0;
    const isPaid  = (order.payment_status || order.paymentStatus) === 'paid';
    const items   = order.items || [];
    const oStatus = order.order_status || 'pending';
    const sCfg    = ORDER_STATUS[oStatus] || ORDER_STATUS.pending;
    const city    = order.city || '';

    const itemsHtml = items.length > 0
      ? items.map(item => {
          const nm  = item.name || item.code || '';
          const qty = item.qty  || 1;
          const prc = item.price || 0;
          return '<div class="item-block">'
            + '<div class="item-name">' + nm + '</div>'
            + '<div class="item-detail">'
            + '<span>' + qty + ' x Rs ' + formatCurrency(prc) + '</span>'
            + '<span class="amt">Rs ' + formatCurrency(prc * qty) + '</span>'
            + '</div></div><hr class="item-sep">';
        }).join('')
      : '';

    const extraInfo = [
      { label: 'Order #',  value: order.id },
      { label: 'Customer', value: order.customer_name || '' },
      { label: 'Phone',    value: order.customer_phone || '' },
    ];
    if (order.customer_address) extraInfo.push({ label: 'Address', value: order.customer_address });
    if (city)                   extraInfo.push({ label: 'City',    value: city });
    extraInfo.push({ label: 'Payment', value: isPaid ? 'PAID' : 'COD' });
    extraInfo.push({ label: 'Status',  value: `${sCfg.icon} ${sCfg.label}` });
    if (weight > 0)      extraInfo.push({ label: 'Weight', value: weight + ' kg' });
    if (order.notes)     extraInfo.push({ label: 'Note',   value: order.notes });

    const receiptHtml = buildThermalReceipt({
      id:         order.id,
      date, time,
      cashier:    order.createdBy || '',
      payment:    isPaid ? 'PAID' : 'COD',
      itemsHtml,
      subtotal:   order.subtotal || 0,
      discount:   order.discount || 0,
      delivery:   order.delivery || 0,
      total:      order.total    || 0,
      copies:     2,
      copyLabels: ['— Shop Copy —', '— Customer Copy —'],
      extraInfo
    });

    try {
      const result = await window.electronAPI.invoke('print:receipt-silent', receiptHtml);
      if (!result || !result.success) {
        showToast('Receipt print failed: ' + ((result && result.errorType) || 'unknown error'), 'error');
      }
    } catch (error) {
      console.error('Silent receipt print failed:', error);
      showToast('Receipt print failed: ' + error.message, 'error');
    }
  }

  // ── EVENT LISTENERS ───────────────────────────────────────────
  setupEventListeners() {
    if (this.listenersBound) return;
    this.listenersBound = true;
    const newBtn = document.getElementById('btn-new-online-order');
    if (newBtn) {
      const newBtnClone = newBtn.cloneNode(true);
      newBtn.parentNode.replaceChild(newBtnClone, newBtn);
      newBtnClone.addEventListener('click', () => this.openNewOrderForm());
    }

    const form = document.getElementById('online-order-form');
    if (form) {
    const formClone = form.cloneNode(true);
    form.parentNode.replaceChild(formClone, form);
    formClone.addEventListener('submit', e => this.handleOrderFormSubmit(e));

    const productSearchEl = document.getElementById('online-product-search');
    if (productSearchEl) {
      productSearchEl.addEventListener('input', e => {
        this.productSearch = e.target.value;
        this.renderProductPicker();
      });
    }

    // City change listener for payment status logic
    const cityEl = document.getElementById('online-city');
    if (cityEl) {
      cityEl.addEventListener('change', e => {
        this.updatePaymentStatusOptions(e.target.value);
      });
    }
    }

    const searchEl = document.getElementById('online-search-input');
    if (searchEl) {
      searchEl.addEventListener('input', e => {
        this.searchTerm = e.target.value;
        this.applyFilter();
      });
    }

    const clearBtn = document.getElementById('btn-online-search-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        const el = document.getElementById('online-search-input');
        if (el) el.value = '';
        this.searchTerm = '';
        this.applyFilter();
      });
    }

    document.querySelectorAll('#tab-online .filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#tab-online .filter-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = btn.getAttribute('data-filter');
        this.applyFilter();
      });
    });

    const cityFilter = document.getElementById('online-city-filter');
    if (cityFilter) {
      cityFilter.addEventListener('change', e => {
        this.activeCity   = e.target.value;
        this.activeFilter = e.target.value ? 'city' : 'all';
        document.querySelectorAll('#tab-online .filter-tab').forEach(b => b.classList.remove('active'));
        if (!e.target.value) {
          document.querySelector('[data-filter="all"]')?.classList.add('active');
        }
        this.applyFilter();
      });
    }
  }
}

const online = new OnlineOrdersManager();

// ── BULK ACTIONS TOOLBAR HTML ─────────────────────────────────
// This will be inserted into the HTML after the online-header
function getBulkActionsToolbarHTML() {
  return `
    <div id="bulk-actions-toolbar" class="bulk-actions-toolbar" style="display:none;align-items:center;gap:12px;padding:12px 16px;background:linear-gradient(145deg,#1a1e2a,#161923);border:1px solid #252836;border-radius:10px;margin-bottom:12px;flex-shrink:0;">
      <span style="font-size:14px;font-weight:600;color:var(--yellow);">
        <span id="bulk-selected-count">0</span> orders selected
      </span>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <select id="bulk-status-select" class="control-input" style="height:36px;width:140px;">
          <option value="">Bulk Status</option>
          <option value="pending">🕐 Pending</option>
          <option value="shipping">🚚 Shipping</option>
          <option value="delivered">✅ Delivered</option>
        </select>
        <button onclick="online.bulkUpdateStatus('delivered')" class="btn-success" style="height:36px;padding:0 16px;font-size:13px;">
          ✅ Mark Delivered
        </button>
        <button onclick="online.bulkUpdateStatus('shipping')" class="btn-secondary" style="height:36px;padding:0 16px;font-size:13px;">
          🚚 Mark Shipping
        </button>
        <button onclick="online.bulkUpdateStatus('pending')" class="btn-secondary" style="height:36px;padding:0 16px;font-size:13px;">
          🕐 Mark Pending
        </button>
        <button onclick="online.clearSelection()" class="btn-secondary" style="height:36px;padding:0 16px;font-size:13px;">
          ✕ Clear Selection
        </button>
      </div>
    </div>
  `;
}

// Initialize bulk actions toolbar when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  const onlineHeader = document.querySelector('#tab-online .online-header');
  if (onlineHeader) {
    onlineHeader.insertAdjacentHTML('afterend', getBulkActionsToolbarHTML());
  }
  
  // Handle bulk status select change
  const bulkStatusSelect = document.getElementById('bulk-status-select');
  if (bulkStatusSelect) {
    bulkStatusSelect.addEventListener('change', function() {
      if (this.value) {
        online.bulkUpdateStatus(this.value);
        this.value = '';
      }
    });
  }
});