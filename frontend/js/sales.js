/**
 * SALES MODULE
 *
 * Cart management, product grid, receipt printing, F9 shortcut.
 * FIX: Print Bill = save + print. Complete = save only.
 *      Products shown as clickable grid — no typing required.
 *      Stock check only when product.qty < 999 (i.e. tracked).
 */

class SalesManager {

  constructor() {
    this.cart     = [];
    this.products = [];
    this.subtotal = 0;
    this.discount = 0;
    this.cashback = 0;
    this.delivery = 0;
    this.total    = 0;
    this.isSaving = false;
  }

  // ── INIT ──────────────────────────────────────────────────────

  async init() {
    try {
      await this.loadProducts();
      this.setupEventListeners();
      this.renderProducts();
      this.renderCart();
      this.updateSummary();
    } catch (error) {
      console.error('Sales init failed:', error);
      showToast('Failed to initialize sales', 'error');
    }
  }

  // ── LOAD PRODUCTS ─────────────────────────────────────────────

  async loadProducts() {
    try {
      this.products = await API.getProducts();
    } catch (error) {
      console.error('Load products error:', error);
      throw error;
    }
  }

  // ── SEARCH ────────────────────────────────────────────────────

  searchProducts(term) {
    this.renderProducts();
  }

  escapeDisplay(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  }

  renderFilters() {
    [['pos-category', 'category', 'All categories'], ['pos-brand', 'brand', 'All brands']].forEach(([id, key, label]) => {
      const el = document.getElementById(id);
      if (!el) return;
      const selected = el.value;
      const values = [...new Set(this.products.map(p => p[key]).filter(Boolean))].sort();
      el.innerHTML = `<option value="">${label}</option>` + values.map(v => `<option value="${this.escapeDisplay(v)}">${this.escapeDisplay(v)}</option>`).join('');
      el.value = values.includes(selected) ? selected : '';
    });
  }

  // ── RENDER PRODUCTS ───────────────────────────────────────────

  renderProducts(products = this.products) {
    const listEl = document.getElementById('product-list');
    if (!listEl) return;

    this.renderFilters();
    const term = (document.getElementById('search-product')?.value || '').toLowerCase().trim();
    const category = document.getElementById('pos-category')?.value;
    const brand = document.getElementById('pos-brand')?.value;
    products = products.filter(p => (!term || [p.name, p.code].some(v => String(v || '').toLowerCase().includes(term))) && (!category || p.category === category) && (!brand || p.brand === brand));
    const count = document.getElementById('pos-product-count');
    if (count) count.textContent = `${products.length} products`;

    if (products.length === 0) {
      listEl.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>No matching products</p><small>Try a different name, code, category or brand.</small></div>`;
      return;
    }

    listEl.innerHTML = products.map(product => {
      const cartItem   = this.cart.find(c => c.code === product.code);
      const qtyInCart  = cartItem ? cartItem.qty : 0;
      // Only block if stock is actually being tracked (qty < 999)
      const tracked    = Number(product.qty) < 999;
      const outOfStock = tracked && Number(product.qty) <= 0;

      return `
        <button type="button" class="product-card ${qtyInCart > 0 ? 'is-selected' : ''} ${outOfStock ? 'out-of-stock' : ''}" ${outOfStock ? 'disabled' : ''}
             onclick="${outOfStock ? '' : this.escapeDisplay(`sales.addToCart(${JSON.stringify(product.code)})`)}"
             style="${outOfStock ? 'opacity:.4;cursor:not-allowed;' : 'cursor:pointer;'}">
          <span class="product-category">${this.escapeDisplay(product.category || 'General')}</span>
          <div class="product-card-name">${this.escapeDisplay(product.name)}</div>
          <div class="pos-product-meta">${this.escapeDisplay([product.brand, product.size, product.variant, product.type].filter(Boolean).join(' · '))}</div>
          <div class="product-card-footer">
            <div class="product-card-price">Rs ${formatCurrency(product.price)}</div>
            ${qtyInCart > 0
              ? `<div class="cart-badge">${qtyInCart} in cart</div>`
              : outOfStock
                ? `<div style="color:var(--red);font-size:12px;">Out of stock</div>`
                : `<div style="color:var(--muted);font-size:12px;">Tap to add</div>`}
          </div>
        </button>
      `;
    }).join('');
  }

  // ── ADD TO CART ───────────────────────────────────────────────

  addToCart(code, qty = 1) {
    if (this.isSaving) return;
    try {
      const product = this.products.find(p => p.code === code);
      if (!product) throw new Error('Product not found');

      const tracked = Number(product.qty) < 999;

      if (tracked && Number(product.qty) <= 0) {
        showToast('Out of stock', 'warning');
        return;
      }

      const cartItem = this.cart.find(c => c.code === code);

      if (cartItem) {
        if (tracked && cartItem.qty + qty > Number(product.qty)) {
          showToast(`Only ${product.qty} available`, 'warning');
          return;
        }
        cartItem.qty += qty;
      } else {
        this.cart.push({
          code:  product.code,
          name:  product.name,
          brand: product.brand || '',
          type:  product.type  || '',
          price: Number(product.price),
          qty
        });
      }

      this.updateSummary();
      this.renderCart();
      this.renderProducts();

      showToast(`${product.name} added`, 'success');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  // ── REMOVE FROM CART ──────────────────────────────────────────

  removeFromCart(code) {
    if (this.isSaving) return;
    this.cart = this.cart.filter(i => i.code !== code);
    this.updateSummary();
    this.renderCart();
    this.renderProducts();
  }

  // ── UPDATE QTY ────────────────────────────────────────────────

  updateCartItemQty(code, qty) {
    if (this.isSaving) return;
    if (qty <= 0) { this.removeFromCart(code); return; }

    const item    = this.cart.find(i => i.code === code);
    if (!item) return;

    const product = this.products.find(p => p.code === code);
    const tracked = product && Number(product.qty) < 999;

    if (tracked && qty > Number(product.qty)) {
      showToast(`Only ${product.qty} available`, 'warning');
      return;
    }

    item.qty = qty;
    this.updateSummary();
    this.renderCart();
    this.renderProducts();
  }

  // ── RENDER CART ───────────────────────────────────────────────

  renderCart() {
    const cartEl = document.getElementById('cart-items');
    if (!cartEl) return;
    const count = document.getElementById('pos-cart-count');
    if (count) count.textContent = `${this.cart.reduce((sum, item) => sum + item.qty, 0)} items`;

    if (this.cart.length === 0) {
      cartEl.innerHTML = `<div class="cart-empty"><p>Your next sale starts here</p><small>Select a product to add your first item.</small></div>`;
      return;
    }

    cartEl.innerHTML = this.cart.map(item => {
      const product = this.products.find(p => p.code === item.code) || item;
      const code = JSON.stringify(item.code);
      return `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${this.escapeDisplay(item.name)}</div>
          <div class="pos-product-meta">${this.escapeDisplay([product.brand, product.size, product.variant, product.type].filter(Boolean).join(' · '))}</div>
          <div class="cart-item-price">Unit price: Rs ${formatCurrency(item.price)}</div>
        </div>
        <div class="cart-item-controls">
          <button class="qty-button" aria-label="Decrease quantity" onclick="${this.escapeDisplay(`sales.updateCartItemQty(${code}, ${item.qty - 1})`)}">−</button>
          <span class="qty-display" aria-label="Quantity">${item.qty}</span>
          <button class="qty-button" aria-label="Increase quantity" onclick="${this.escapeDisplay(`sales.updateCartItemQty(${code}, ${item.qty + 1})`)}">+</button>
          <button class="pos-remove" onclick="${this.escapeDisplay(`sales.removeFromCart(${code})`)}" aria-label="Remove ${this.escapeDisplay(item.name)}">Remove</button>
          <div class="pos-line-total"><small>Line total</small><strong>Rs ${formatCurrency(item.price * item.qty)}</strong></div>
        </div>
      </div>
    `; }).join('');
  }

  // ── UPDATE SUMMARY ────────────────────────────────────────────

  updateSummary() {
    this.subtotal = this.cart.reduce((s, i) => s + i.price * i.qty, 0);

    const discountEl      = document.getElementById('sale-discount');
    const deliveryEl      = document.getElementById('sale-delivery');
    const cashReceivedEl  = document.getElementById('cash-received');

    this.discount     = discountEl     ? Number(discountEl.value)     || 0 : 0;
    this.delivery     = deliveryEl     ? Number(deliveryEl.value)     || 0 : 0;
    this.cashReceived = cashReceivedEl ? Number(cashReceivedEl.value) || 0 : 0;

    // Total = subtotal - discount + delivery
    this.total = Math.max(0, this.subtotal - this.discount + this.delivery);

    // Cashback = cash received - total (only if cash payment and received > total)
    const paymentMethod = document.getElementById('payment-method')?.value || 'cash';
    if (paymentMethod === 'cash' && this.cashReceived > 0) {
      this.cashback = Math.max(0, this.cashReceived - this.total);
    } else {
      this.cashback = 0;
    }

    // Update cashback display
    const cashbackAmountEl = document.getElementById('cashback-amount');
    if (cashbackAmountEl) {
      cashbackAmountEl.textContent = 'Rs ' + formatCurrency(this.cashback);
      // Highlight if cashback > 0
      cashbackAmountEl.style.color = this.cashback > 0 ? 'var(--green)' : 'var(--muted)';
    }

    const subtotalEl = document.getElementById('sale-subtotal');
    const totalEl    = document.getElementById('sale-total');
    if (subtotalEl) subtotalEl.textContent = `Rs ${formatCurrency(this.subtotal)}`;
    if (totalEl)    totalEl.textContent    = `Rs ${formatCurrency(this.total)}`;
  }

  // ── CLEAR CART ────────────────────────────────────────────────

  clearCart() {
    this.cart = [];
    const d  = document.getElementById('sale-discount');
    const v  = document.getElementById('sale-delivery');
    const cr = document.getElementById('cash-received');
    if (d)  d.value  = 0;
    if (v)  v.value  = 0;
    if (cr) cr.value = '';
    this.cashback     = 0;
    this.cashReceived = 0;
    // Reset cashback display
    const cbDisplay = document.getElementById('cashback-amount');
    if (cbDisplay) { cbDisplay.textContent = 'Rs 0'; cbDisplay.style.color = ''; }
    this.updateSummary();
    this.renderCart();
    this.renderProducts();
    showToast('Cart cleared', 'info');
  }

  // ── BUILD SALE OBJECT ─────────────────────────────────────────

  buildSaleData() {
    const paymentMethod = document.getElementById('payment-method')?.value || 'cash';
    const user = auth.getCurrentUser();
    const saleId = 'INV-' + crypto.randomUUID();

    return {
      id:             saleId,
      user_id:        user ? user.id : 1,
      cashier:        user ? user.username : 'Cashier',
      items:          this.cart.map(item => ({...item})),
      subtotal:       this.subtotal,
      discount:       this.discount,
      cashback:       this.cashback,
      cashReceived:   this.cashReceived,
      delivery:       this.delivery,
      tax:            0,
      total:          this.total,
      payment_method: paymentMethod,
      payment_status: 'paid',
      notes:          ''
    };
  }

  // ── COMPLETE SALE (save only, no print) ───────────────────────

  async completeSale(andPrint = false) {
    if (this.cart.length === 0) {
      showToast('Cart is empty', 'warning');
      return;
    }
    if (this.isSaving) return;

    this.updateSummary();
    const invalidInput = ['sale-discount','sale-delivery','cash-received'].some(id => {
      const el=document.getElementById(id); return el && (el.validity?.badInput || !Number.isFinite(Number(el.value)) || Number(el.value)<0);
    });
    if (invalidInput || this.discount > this.subtotal || !Number.isFinite(this.total)) {
      showToast('Check discount, delivery and cash amounts. Discount cannot exceed subtotal.', 'warning'); return;
    }
    if (document.getElementById('payment-method')?.value === 'cash' && this.cashReceived > 0 && this.cashReceived < this.total) {
      showToast('Cash received is less than the total due.', 'warning'); return;
    }
    this.isSaving = true;
    const controls = [...(document.querySelectorAll?.('#tab-sales button, #tab-sales input, #tab-sales select') || [])];
    const disabled = controls.map(el => el.disabled);
    controls.forEach(el => el.disabled = true);
    try {
      const saleData = this.buildSaleData();

      const saved = await API.createSale(saleData);
      if (!saved?.success) throw new Error(saved?.message || "Sale was not saved. Please retry.");

      if (andPrint) {
        setTimeout(() => this.printReceipt(saleData), 0);
      }

      this.clearCart();
      showToast(`Sale ${saleData.id} completed!`, 'success');
      const pdfStatus = document.getElementById('pos-pdf-status');
      if (pdfStatus) {
        pdfStatus.hidden = false;
        pdfStatus.textContent = saved.pdf?.success
          ? `Invoice ${saleData.id} saved with PDF. Open it in Invoice PDFs.`
          : `Sale ${saleData.id} is saved. PDF failed: ${saved.pdf?.error || 'Unknown error'}. Retry in Invoice PDFs.`;
        pdfStatus.classList.toggle('pdf-failed', !saved.pdf?.success);
      }
      // A product refresh failure must not leave a committed sale in the cart.
      try { await this.loadProducts(); this.renderProducts(); }
      catch (error) { showToast('Sale saved. Could not refresh products; reload before the next sale.', 'warning'); }
    } catch (error) {
      console.error('Complete Sale Error:', error);
      showToast(error.message, 'error');
    } finally {
      this.isSaving = false;
      controls.forEach((el, i) => { el.disabled = disabled[i]; });
    }
  }

  // ── PRINT ONLY (without saving) ───────────────────────────────

  printOnly() {
    if (this.cart.length === 0) {
      showToast('Cart is empty', 'warning');
      return;
    }
    const saleData = this.buildSaleData();
    saleData.id = 'PREVIEW-' + Date.now();
    this.printReceipt(saleData);
  }

  // ── PRINT RECEIPT ─────────────────────────────────────────────

  async printReceipt(sale) {
    const now  = new Date();
    const date = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const time = now.toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:true });

    var itemsHtml = sale.items.map(function(item) {
      return '<div class="item-block">'
        + '<div class="item-name">' + String(item.name || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) + '</div>'
        + '<div class="item-detail">'
        +   '<span>' + item.qty + ' x Rs ' + formatCurrency(item.price) + '</span>'
        +   '<span class="amt">Rs ' + formatCurrency(item.price * item.qty) + '</span>'
        + '</div>'
        + '</div>'
        + '<hr class="item-sep">';
    }).join('');

    const receiptHtml = buildThermalReceipt({
      id:           sale.id,
      date,         time,
      cashier:      sale.cashier || 'Cashier',
      payment:      (sale.payment_method || 'CASH').toUpperCase(),
      itemsHtml,
      receiptTitle: sale.notes === 'WHOLESALE' ? 'Wholesale Invoice' : 'Original Receipt',
      subtotal:     sale.subtotal,
      discount:     sale.discount      || 0,
      cashback:     sale.cashback      || 0,
      cashReceived: sale.cashReceived  || 0,
      delivery:     sale.delivery      || 0,
      total:        sale.total,
      copies:       1,
      extraInfo:    []
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
    document.getElementById('btn-invoice-pdfs')?.addEventListener('click', () => this.openInvoicePdfs());
    ['pos-category', 'pos-brand'].forEach(id => document.getElementById(id)?.addEventListener('change', () => this.renderProducts()));
    // Search
    const searchEl = document.getElementById('search-product');
    if (searchEl) {
      searchEl.addEventListener('input', e => this.searchProducts(e.target.value));
    }

    // Discount / Delivery
    document.getElementById('sale-discount')?.addEventListener('input', () => this.updateSummary());
    document.getElementById('sale-delivery')?.addEventListener('input', () => this.updateSummary());

    // Cash received input — auto calculate cashback
    document.getElementById('cash-received')?.addEventListener('input', () => this.updateSummary());

    // Payment method toggle — show/hide cash received section
    const paymentMethodEl = document.getElementById('payment-method');
    if (paymentMethodEl) {
      paymentMethodEl.addEventListener('change', () => {
        const isCash    = paymentMethodEl.value === 'cash';
        const cashSec   = document.getElementById('cash-received-section');
        const cashInput = document.getElementById('cash-received');
        if (cashSec) cashSec.style.display = isCash ? 'block' : 'none';
        if (cashInput && !isCash) cashInput.value = '';
        this.updateSummary();
      });
    }

    // Print Bill (F9 equivalent button) — save + print
    document.getElementById('btn-print-sale')?.addEventListener('click', () => this.completeSale(true));

    // Complete Sale (no print)
    document.getElementById('btn-complete-sale')?.addEventListener('click', () => this.completeSale(false));

    // Clear Cart
    document.getElementById('btn-clear-cart')?.addEventListener('click', () => this.clearCart());

    // F9 — save + print
    document.addEventListener('keydown', async e => {
      if (e.key === 'F9' && document.getElementById('tab-sales')?.classList.contains('active') && auth.isLoggedIn() && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        this.completeSale(true);
      }
    });
  }

  async openInvoicePdfs() {
    const panel = document.getElementById('invoice-pdf-dialog');
    if (!panel.open) panel.showModal();
    await this.loadInvoicePdfs();
  }

  async loadInvoicePdfs() {
    const list = document.getElementById('invoice-pdf-list');
    list.textContent = 'Loading invoices…';
    try {
      const rows = await API.invoke('invoice:pdf:list', document.getElementById('invoice-pdf-search').value);
      list.replaceChildren();
      for (const invoice of rows) {
        const row = document.createElement('div');
        row.className = 'invoice-pdf-row';
        const info = document.createElement('div');
        const title = document.createElement('strong');
        title.textContent = `${invoice.id} · Rs ${formatCurrency(invoice.total)}`;
        const status = document.createElement('p');
        status.textContent = `${new Date(invoice.created_at).toLocaleString()} · PDF ${invoice.pdf_status || 'pending'}${invoice.pdf_error ? ': ' + invoice.pdf_error : ''}`;
        info.append(title, status);
        const action = document.createElement('button');
        action.className = 'btn-primary';
        action.textContent = invoice.pdf_status === 'ready' ? 'Open PDF' : 'Generate / Retry PDF';
        action.addEventListener('click', async () => {
          action.disabled = true;
          action.textContent = 'Please wait…';
          try {
            const result = await API.invoke(invoice.pdf_status === 'ready' ? 'invoice:pdf:open' : 'invoice:pdf:generate', invoice.id);
            if (!result.success) throw new Error(result.error);
            showToast('Invoice PDF ready', 'success');
          } catch (error) { showToast(`PDF: ${error.message}. Sale remains saved.`, 'error'); }
          await this.loadInvoicePdfs();
        });
        row.append(info, action);
        list.append(row);
      }
      if (!rows.length) list.textContent = 'No invoices found.';
    } catch (error) { list.textContent = `Unable to load invoices: ${error.message}`; }
  }
}

// GLOBAL
const sales = new SalesManager();
