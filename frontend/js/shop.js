class ShopManager {
  constructor() { this.products = []; this.selected = new Map(); this.busy = false; this.ready = false; this.historyPage = 0; }
  transferLabel(id) { return `ST-${String(id).padStart(5, '0')}`; }
  dateLabel(value) { return new Date(value).toLocaleDateString('en-GB').replaceAll('/', '-'); }
  timeLabel(value) { return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }); }
  statusLabel(value) { return value === 'posted' ? 'Completed' : String(value || 'Unknown'); }
  newReference() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }
  escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  async init() {
    if (!this.ready) { this.setup(); this.ready = true; }
    await this.refresh();
  }
  setup() {
    document.getElementById('tab-shop').innerHTML = `
      <div class="shop-heading"><div><h2>SHOP</h2><p>Warehouse → Shop · Stock issues</p></div><button id="shop-new" class="btn-primary">＋ New Shop Issue</button></div>
      <div id="shop-message" role="status" hidden></div>
      <form id="shop-form" hidden><fieldset id="shop-fields">
        <div class="shop-heading"><h3>New Shop Issue</h3><button type="button" id="shop-cancel" class="btn-secondary">Cancel</button></div>
        <div class="shop-fields">
          <label>Person Name<input id="shop-person" class="control-input" required maxlength="150" placeholder="e.g. Ahmed"></label>
          <label>Shop/Location<input id="shop-location" class="control-input" required maxlength="150" list="shop-locations" placeholder="e.g. Main Shop"><datalist id="shop-locations"></datalist></label>
          <label>Date<input id="shop-date" class="control-input" type="date" required></label>
          <label>Time<input id="shop-time" class="control-input" type="time" required></label>
        </div>
        <div class="shop-products-layout">
          <section><h3>Select from warehouse inventory</h3><input id="shop-search" type="search" class="search-input" aria-label="Search inventory" placeholder="Search brand, product, category or code…"><div class="shop-table-scroll shop-picker"><table><thead><tr><th>Brand / Product / Category</th><th>Available Stock</th><th></th></tr></thead><tbody id="shop-products"></tbody></table></div></section>
          <section><h3>Products to issue</h3><div class="shop-table-scroll"><table><thead><tr><th>Product</th><th>Available</th><th>Issue Quantity</th><th></th></tr></thead><tbody id="shop-selected"></tbody></table></div></section>
        </div>
        <div class="shop-summary"><div><span>Total Products</span><strong id="shop-total-products">0</strong></div><div><span>Total Quantity</span><strong id="shop-total-quantity">0</strong></div><button id="shop-confirm" class="btn-primary" type="submit">CONFIRM SHOP ISSUE</button></div>
      </fieldset></form>
      <section class="shop-history"><div class="shop-heading"><h3>Transfer history</h3><button id="shop-refresh" class="btn-secondary">Refresh</button></div><p>Completed warehouse → shop transfers · Read-only records</p><div class="shop-table-scroll"><table><thead><tr><th>Transfer ID</th><th>Person Name</th><th>Shop/Location</th><th>Date</th><th>Time</th><th>Total Items</th><th>Total Quantity</th><th>Status</th><th>Actions</th></tr></thead><tbody id="shop-history"></tbody></table></div><div class="shop-history-pages"><button id="shop-previous" type="button" class="btn-secondary">Previous</button><span id="shop-history-page"></span><button id="shop-next" type="button" class="btn-secondary">Next</button></div></section>
      <dialog id="shop-detail"><div class="shop-heading"><h3>Shop stock issue</h3><button type="button" id="shop-close-detail" class="btn-secondary">Close</button></div><div id="shop-detail-content"></div></dialog>`;
    document.getElementById('shop-new').addEventListener('click', () => this.newIssue());
    document.getElementById('shop-cancel').addEventListener('click', () => { document.getElementById('shop-form').hidden = true; });
    document.getElementById('shop-refresh').addEventListener('click', () => this.refresh());
    document.getElementById('shop-previous').addEventListener('click', () => this.loadHistory(Math.max(0, this.historyPage - 1)));
    document.getElementById('shop-next').addEventListener('click', () => this.loadHistory(this.historyPage + 1));
    document.getElementById('shop-search').addEventListener('input', () => this.renderProducts());
    document.getElementById('shop-form').addEventListener('submit', e => { e.preventDefault(); this.confirm(); });
    document.getElementById('shop-close-detail').addEventListener('click', () => document.getElementById('shop-detail').close());
    document.getElementById('shop-products').addEventListener('click', e => {
      const button = e.target.closest('button[data-code]');
      if (!button || this.busy) return;
      this.selected.set(button.dataset.code, 1); this.renderSelected(); this.renderProducts();
    });
    document.getElementById('shop-selected').addEventListener('input', e => {
      if (!e.target.matches('input[data-code]') || this.busy) return;
      this.selected.set(e.target.dataset.code, Number(e.target.value)); this.summary();
    });
    document.getElementById('shop-selected').addEventListener('click', e => {
      const button = e.target.closest('button[data-code]');
      if (!button || this.busy) return;
      this.selected.delete(button.dataset.code); this.renderSelected(); this.renderProducts();
    });
    document.getElementById('shop-history').addEventListener('click', e => {
      const button = e.target.closest('button[data-id]');
      if (button) this.details(Number(button.dataset.id));
    });
  }
  message(text, error = false) {
    const el = document.getElementById('shop-message'); el.hidden = false; el.textContent = text; el.classList.toggle('shop-error', error);
  }
  async refresh() {
    try {
      const [products, locations] = await Promise.all([API.getProducts(), API.invoke('shop:locations')]);
      this.products = products;
      document.getElementById('shop-locations').innerHTML = locations.map(l => `<option value="${this.escape(l.name)}"></option>`).join('');
      await this.loadHistory(this.historyPage);
      this.renderProducts(); this.renderSelected();
    } catch (error) { this.message(`Unable to refresh shop inventory: ${error.message}`, true); }
  }
  async loadHistory(page = 0) {
    if (this.historyLoading) return;
    this.historyLoading = true;
    const previous = document.getElementById('shop-previous'), next = document.getElementById('shop-next');
    previous.disabled = true; next.disabled = true;
    try {
      const history = await API.invoke('shop:list', page);
      this.historyPage = page; this.historyHasNext = history.length === 100;
      document.getElementById('shop-history').innerHTML = history.map(t => `<tr><td class="shop-reference">${this.escape(this.transferLabel(t.id))}</td><td>${this.escape(t.person_name)}</td><td>${this.escape(t.shop_name)}</td><td class="shop-nowrap">${this.escape(this.dateLabel(t.transferred_at))}</td><td class="shop-nowrap">${this.escape(this.timeLabel(t.transferred_at))}</td><td>${this.escape(t.total_products)}</td><td>${this.escape(t.total_quantity)} pcs</td><td><span class="shop-status">${this.escape(this.statusLabel(t.status))}</span></td><td><button type="button" class="btn-secondary" data-id="${t.id}" title="View transfer details">View</button></td></tr>`).join('') || '<tr><td colspan="9">No transfers on this page.</td></tr>';
      document.getElementById('shop-history-page').textContent = `Page ${page + 1} · ${history.length} transfers`;
    } catch (error) { this.message(`Unable to load transfer history: ${error.message}`, true); }
    finally { this.historyLoading = false; previous.disabled = this.historyPage === 0; next.disabled = !this.historyHasNext; }
  }
  async newIssue() {
    if (this.busy) return;
    const form = document.getElementById('shop-form');
    if (!form.hidden) { document.getElementById('shop-person').focus(); return; }
    form.reset(); this.selected.clear(); this.requestId = this.newReference();
    const now = new Date();
    document.getElementById('shop-date').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    document.getElementById('shop-time').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    form.hidden = false; document.getElementById('shop-message').hidden = true;
    await this.refresh(); document.getElementById('shop-person').focus();
  }
  renderProducts() {
    const search = document.getElementById('shop-search').value.toLowerCase().trim();
    const filtered = this.products.filter(p => [p.name,p.brand,p.category,p.code].join(' ').toLowerCase().includes(search));
    document.getElementById('shop-products').innerHTML = filtered.map(p => `<tr><td><small>${this.escape(p.brand || '—')}</small><strong>${this.escape(p.name)}</strong><small>${this.escape(p.category || '—')} · ${this.escape(p.code)}</small></td><td>${this.escape(p.qty)}</td><td><button type="button" class="btn-secondary" data-code="${this.escape(p.code)}" ${Number(p.qty) <= 0 || this.selected.has(p.code) ? 'disabled' : ''}>${this.selected.has(p.code) ? 'Selected' : 'Add'}</button></td></tr>`).join('') || '<tr><td colspan="3">No products found.</td></tr>';
  }
  renderSelected() {
    document.getElementById('shop-selected').innerHTML = [...this.selected].map(([code, quantity]) => {
      const p = this.products.find(p => p.code === code);
      return `<tr><td><small>${this.escape(p?.brand || '—')}</small><strong>${this.escape(p?.name || code)}</strong><small>${this.escape(p?.category || 'Product unavailable')}</small></td><td>${this.escape(p?.qty ?? 0)}</td><td><input class="control-input shop-qty" type="number" required min="1" step="1" data-code="${this.escape(code)}" aria-label="Issue quantity for ${this.escape(p?.name || code)}" value="${quantity}"></td><td><button type="button" class="shop-remove" data-code="${this.escape(code)}" aria-label="Remove ${this.escape(p?.name || code)}">Remove</button></td></tr>`;
    }).join('') || '<tr><td colspan="4">Select products from the existing inventory.</td></tr>';
    this.summary();
  }
  summary() {
    document.getElementById('shop-total-products').textContent = this.selected.size;
    document.getElementById('shop-total-quantity').textContent = [...this.selected.values()].reduce((sum, qty) => sum + qty, 0);
    document.getElementById('shop-confirm').disabled = this.busy || !this.selected.size;
  }
  async confirm() {
    if (this.busy || !this.selected.size) return;
    const form = document.getElementById('shop-form');
    if (!form.reportValidity()) return;
    this.busy = true; document.getElementById('shop-fields').disabled = true; document.getElementById('shop-new').disabled = true;
    document.getElementById('shop-confirm').textContent = 'Saving shop issue…';
    try {
      const transferredAt = new Date(`${document.getElementById('shop-date').value}T${document.getElementById('shop-time').value}`).toISOString();
      await API.invoke('shop:issue', { requestId: this.requestId, person: document.getElementById('shop-person').value, location: document.getElementById('shop-location').value, transferredAt, items: [...this.selected].map(([code,quantity]) => ({code,quantity})) });
      this.selected.clear(); form.hidden = true; this.historyPage = 0;
      this.message('Shop stock issue completed successfully.');
      showToast('Shop stock issue completed successfully.', 'success');
      await this.refresh();
      // Refresh the existing inventory and POS product views, without creating a sale.
      const results = await Promise.allSettled([
        typeof inventory !== 'undefined' ? inventory.loadProducts() : Promise.resolve(),
        typeof sales !== 'undefined' ? sales.loadProducts().then(() => sales.renderProducts()) : Promise.resolve()
      ]);
      if (results.some(r => r.status === 'rejected') || (typeof inventory !== 'undefined' && inventory.loadError)) this.message('Shop stock issue completed successfully. Some stock views could not refresh; reload them before continuing.');
    } catch (error) {
      await this.refresh(); this.message(error.message, true); showToast(error.message, 'error');
    } finally {
      this.busy = false; document.getElementById('shop-fields').disabled = false; document.getElementById('shop-new').disabled = false;
      document.getElementById('shop-confirm').textContent = 'CONFIRM SHOP ISSUE'; this.summary();
    }
  }
  async details(id) {
    try {
      const t = await API.invoke('shop:details', id);
      document.getElementById('shop-detail-content').innerHTML = `<h2>Transfer #${this.escape(this.transferLabel(t.id))}</h2><span class="shop-status">${this.escape(this.statusLabel(t.status))}</span><dl class="shop-detail-meta"><div><dt>Person Name</dt><dd>${this.escape(t.person_name)}</dd></div><div><dt>Shop/Location</dt><dd>${this.escape(t.shop_name)}</dd></div><div><dt>Date</dt><dd>${this.escape(this.dateLabel(t.transferred_at))}</dd></div><div><dt>Time</dt><dd>${this.escape(this.timeLabel(t.transferred_at))}</dd></div><div><dt>From</dt><dd>${this.escape(t.source_name || 'Warehouse')}</dd></div><div><dt>Recorded by</dt><dd>${this.escape(t.created_by_username)}</dd></div></dl><div class="shop-table-scroll"><table><thead><tr><th>Brand</th><th>Product</th><th>Category</th><th>Issued</th></tr></thead><tbody>${t.items.map(i => `<tr><td>${this.escape(i.brand)}</td><td>${this.escape(i.product_name)}<small>${this.escape(i.product_code)}</small></td><td>${this.escape(i.category)}</td><td class="shop-nowrap">${this.escape(i.quantity)} pcs</td></tr>`).join('')}</tbody></table></div><div class="shop-summary"><div><span>Total Items</span><strong>${t.items.length}</strong></div><div><span>Total Quantity</span><strong>${t.items.reduce((sum,i) => sum + Number(i.quantity), 0)} pcs</strong></div></div><p>Recorded: ${this.escape(this.dateLabel(t.created_at))} ${this.escape(this.timeLabel(t.created_at))}${t.posted_at ? `<br>Completed: ${this.escape(this.dateLabel(t.posted_at))} ${this.escape(this.timeLabel(t.posted_at))}` : ''}</p>${t.notes ? `<p>Notes: ${this.escape(t.notes)}</p>` : ''}<p class="shop-full-reference">Reference: ${this.escape(t.transfer_number)}</p><p>Completed transfers are read-only. Any correction requires a separate stock adjustment or reversal.</p>`;
      const dialog = document.getElementById('shop-detail');
      if (!dialog.open) dialog.showModal();
    } catch (error) { this.message(error.message, true); }
  }
}
const shopManager = new ShopManager();
