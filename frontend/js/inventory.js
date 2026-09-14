/**
 * INVENTORY MODULE
 * Products: Name + Category + Price + optional Qty
 * Categories: Suits / Accessories / Single Pcs
 */




class InventoryManager {

  constructor() {
    this.categories = [];
    this.products         = [];
    this.filteredProducts = [];
    this.searchTerm       = '';
    this.activeCategory   = ''; // '' = all
    this.editingProduct   = null;
    this.loading = false;
    this.loadError = false;
    this.searchIndex = new Map();
  }

  // ── INIT ──────────────────────────────────────────────────────
  async init() {
    try {
      this.setupEventListeners();
      await this.loadProducts();
      this.render();
    } catch (error) {
      console.error('Inventory init failed:', error);
      showToast('Inventory failed to load', 'error');
    }
  }

  // ── LOAD ──────────────────────────────────────────────────────
  async loadProducts() {
    this.loading = true;
    this.loadError = false;
    this.render();
    try {
      this.products = await API.getProducts();
      this.categories = await API.getCategories();
      this.renderCategoryControls();
      this.searchIndex = new Map(this.products.map(p => [p, this.normalizeSearch(
        [p.name, p.brand, p.category, p.code, p.sku, p.type, p.price].filter(v => v != null).join(' ')
      )]));
    } catch (error) {
      this.loadError = true;
      console.error('Inventory load failed:', error);
    } finally {
      this.loading = false;
      this.applyFilter();
    }
  }

  // ── FILTER + SEARCH ───────────────────────────────────────────
  applyFilter() {
    let result = [...this.products];

    if (this.activeCategory) {
      result = result.filter(p => (p.category || '') === this.activeCategory);
    }

    const tokens = this.normalizeSearch(this.searchTerm).split(' ').filter(Boolean);
    if (tokens.length) {
      result = result.filter(p => {
        const text = this.searchIndex.get(p) || '';
        // Accept omitted repeated letters, e.g. "saph" for "Sapphire".
        const compact = value => value.replace(/(\p{L})\1+/gu, '$1');
        return tokens.every(token => text.includes(token) || compact(text).includes(compact(token)));
      });
    }

    this.filteredProducts = result;
    this.render();
  }

  normalizeSearch(value) {
    return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/(\d),(?=\d{3}(?:\D|$))/g, '$1')
      .replace(/[^\p{L}\p{N}.]+/gu, ' ').trim();
  }

  escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // ── VALIDATE ──────────────────────────────────────────────────
  validateProduct(p) {
    if (!p.name?.trim())          throw new Error('Product name is required');
    if (isNaN(p.price) || p.price < 0) throw new Error('Invalid price');
    if (isNaN(p.qty)   || p.qty   < 0) throw new Error('Invalid quantity');
  }

  // ── ADD ───────────────────────────────────────────────────────
  async addProduct(data) {
    this.validateProduct(data);
    await API.addProduct(data);
    await this.loadProducts();
    showToast('Product added', 'success');
  }

  // ── UPDATE ────────────────────────────────────────────────────
  async updateProduct(data) {
    this.validateProduct(data);
    await API.updateProduct(data);
    await this.loadProducts();
    showToast('Product updated', 'success');
  }

  // ── DELETE ────────────────────────────────────────────────────
  async deleteProduct(code) {
    const confirmed = await showConfirm('Delete Product', 'Are you sure you want to delete this product?');
    if (!confirmed) return;
    await API.deleteProduct(code);
    await this.loadProducts();
    if (typeof sales !== 'undefined') {
      await sales.loadProducts();
      sales.renderProducts();
    }
    showToast('Product deleted', 'success');
  }

  // ── RENDER ────────────────────────────────────────────────────
  render() {
    const listEl = document.getElementById('inventory-list');
    if (!listEl) return;

    // Update category tab counts
    this.updateCategoryTabs();
    const tableHead = '<table class="inventory-table"><thead><tr>' +
      ['Product Name', 'Category', 'Brand', 'Price', 'Quantity / Stock', 'SKU / Code', 'Actions']
        .map(label => '<th scope="col">' + label + '</th>').join('') + '</tr></thead><tbody>';

    listEl.setAttribute('aria-busy', String(this.loading));
    const status = document.getElementById('inventory-results');
    if (status) status.textContent = this.loading ? 'Loading inventory…' : this.loadError ? 'Inventory could not be loaded' :
      this.filteredProducts.length + ' of ' + this.products.length + ' products';
    if (this.loading || this.loadError || !this.filteredProducts.length) {
      const title = this.loading ? 'Loading inventory…' : this.loadError ? 'Unable to load inventory' :
        this.products.length ? 'No products found' : 'No inventory available';
      const help = this.loading ? 'Please wait while products load.' : this.loadError ? 'Please try again.' :
        this.products.length ? 'Try fewer words or clear the filters.' : 'Add your first product using the button above.';
      listEl.innerHTML = tableHead + '<tr><td colspan="7"><div class="empty-state"><p>' + title + '</p><small>' + help + '</small>' +
        (this.loadError ? '<button class="btn-secondary" data-action="retry">Retry</button>' : '') + '</div></td></tr></tbody></table>';
      return;
    }
    const escape = value => this.escapeHtml(value);
    listEl.innerHTML = tableHead + this.filteredProducts.map((p, index) => 
        '<tr><td class="inventory-product-name">' + escape(p.name) + '</td>' +
        '<td>' + escape(p.category || '—') + '</td><td>' + escape(p.brand || '—') + '</td>' +
        '<td class="inventory-number">Rs ' + escape(formatCurrency(p.price)) + '</td>' +
        '<td class="inventory-number"><span class="' + (Number(p.qty) === 0 ? 'inventory-out' : '') + '">' +
        escape(p.qty ?? '—') + (Number(p.qty) === 0 ? ' · Out of stock' : '') + '</span></td>' +
        '<td class="inventory-code">' + escape(p.code || p.sku || '—') + '</td>' +
        '<td><div class="inventory-actions"><button class="btn-secondary btn-small" data-action="edit" data-index="' + index + '">Edit</button>' +
        '<button class="btn-danger btn-small" data-action="delete" data-index="' + index + '">Delete</button></div></td></tr>'
      ).join('') + '</tbody></table>';
  }

  // ── CATEGORY HELPERS ──────────────────────────────────────────
  getCategoryColor(cat) {
    const map = { 'Suits': '#f5c542', 'Accessories': '#a78bfa', 'Single Pcs': '#34d399' };
    return map[cat] || '#9ca3af';
  }

  getCategoryIcon(cat) {
    const map = { 'Suits': '👗', 'Accessories': '💍', 'Single Pcs': '👚' };
    return map[cat] || '📦';
  }

  // ── UPDATE CATEGORY TAB COUNTS ────────────────────────────────
  updateCategoryTabs() {
    const tabsEl = document.getElementById('inventory-category-tabs');
    if (!tabsEl) return;

    const names = [...new Set([...this.categories.map(c => c.name), ...this.products.map(p => p.category).filter(Boolean)])];
    tabsEl.innerHTML = ['', ...names].map(cat => '<button class="filter-tab ' + (this.activeCategory === cat ? 'active' : '') + '" data-category="' + this.escapeHtml(cat) + '">' + this.escapeHtml(cat || 'All') + ' (' + (cat ? this.products.filter(p => p.category === cat).length : this.products.length) + ')</button>').join('');
  }

  renderCategoryControls() {
    const select = document.getElementById('product-category');
    if (select) {
      const value = select.value;
      const names = [...new Set([...this.categories.map(c => c.name), ...this.products.map(p => p.category).filter(Boolean)])];
      select.innerHTML = '<option value="">-- Select Category --</option>' + names.map(name => '<option value="' + this.escapeHtml(name) + '">' + this.escapeHtml(name) + '</option>').join('');
      select.value = value;
    }
    const list = document.getElementById('category-management-list');
    if (list) list.innerHTML = this.categories.map(c => '<button type="button" class="btn-danger btn-small" data-category-id="' + c.id + '">Delete ' + this.escapeHtml(c.name) + '</button>').join('') || '<p>No categories. Create one above.</p>';
  }

  // ── SET CATEGORY ──────────────────────────────────────────────
  setCategory(cat) {
    this.activeCategory = cat;
    this.applyFilter();
  }

  // ── EDIT FORM ─────────────────────────────────────────────────
  editProduct(code) {
    const p = this.products.find(x => x.code === code);
    if (!p) return;

    this.editingProduct = p;

    document.getElementById('product-code').value     = p.code;
    document.getElementById('product-name').value     = p.name;
    document.getElementById('product-brand').value    = p.brand || '';
    document.getElementById('product-code-display').value = p.code || '';
    document.getElementById('product-price').value    = p.price;
    document.getElementById('product-qty').value      = p.qty;
    const catEl = document.getElementById('product-category');
    if (catEl) catEl.value = p.category || '';

    document.getElementById('modal-product-title').textContent = 'Edit Product';
    showModal('modal-product-form');
  }

  // ── ADD FORM ──────────────────────────────────────────────────
  openAddForm() {
    this.editingProduct = null;
    document.getElementById('product-form').reset();
    document.getElementById('product-code').value = '';
    document.getElementById('product-code-display').value = '';
    document.getElementById('product-brand').value = '';
    document.getElementById('product-qty').value  = 999;
    const catEl = document.getElementById('product-category');
    if (catEl) catEl.value = '';
    document.getElementById('modal-product-title').textContent = 'Add Product';
    showModal('modal-product-form');
  }

  // ── FORM SUBMIT ───────────────────────────────────────────────
  async handleProductFormSubmit() {
    try {
      const name     = document.getElementById('product-name').value.trim();
      const price    = parseFloat(document.getElementById('product-price').value);
      const qtyValue = document.getElementById('product-qty').value.trim();
      const qty = qtyValue === '' ? 999 : Number(qtyValue);
      const code     = this.editingProduct ? this.editingProduct.code : document.getElementById('product-code').value.trim();
      const brand    = document.getElementById('product-brand').value.trim();
      const category = document.getElementById('product-category')?.value || '';

      if (!category) throw new Error('Please select a category');

      const data = { code, name, brand, price, qty, category };

      if (this.editingProduct) {
        await this.updateProduct(data);
      } else {
        await this.addProduct(data);
      }

      hideModal('modal-product-form');

      // Refresh sales grid too
      if (typeof sales !== 'undefined') {
        await sales.loadProducts();
        sales.renderProducts();
      }
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  // ── EVENT LISTENERS ───────────────────────────────────────────
  setupEventListeners() {
    if (this.listenersBound) return;
    this.listenersBound = true;
    document.getElementById('inventory-category-tabs')?.addEventListener('click', e => {
      const button = e.target.closest('button[data-category]');
      if (button) this.setCategory(button.dataset.category);
    });
    document.getElementById('category-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const button = e.target.querySelector('button');
      button.disabled = true;
      try {
        await API.addCategory(document.getElementById('category-name').value);
        document.getElementById('category-name').value = '';
        await this.loadProducts();
        showToast('Category created', 'success');
      } catch (error) { showToast(error.message, 'error'); }
      finally { button.disabled = false; }
    });
    document.getElementById('category-management-list')?.addEventListener('click', async e => {
      const button = e.target.closest('button[data-category-id]');
      if (!button) return;
      const category = this.categories.find(c => c.id === Number(button.dataset.categoryId));
      if (!category) return;
      button.disabled = true;
      try {
        if (!await showConfirm('Delete Category', 'Delete category “' + category.name + '”?')) return;
        await API.deleteCategory(category.id);
        if (this.activeCategory === category.name) this.activeCategory = '';
        await this.loadProducts();
        showToast('Category deleted', 'success');
      } catch (error) { showToast(error.message, 'error'); }
      finally { button.disabled = false; }
    });
    document.getElementById('inventory-clear')?.addEventListener('click', () => {
      this.searchTerm = '';
      this.activeCategory = '';
      const input = document.getElementById('inventory-search');
      input.value = '';
      this.applyFilter();
      input.focus();
    });
    document.getElementById('inventory-list')?.addEventListener('click', async e => {
      const button = e.target.closest('button[data-action]');
      if (!button) return;
      if (button.dataset.action === 'retry') return this.loadProducts();
      const product = this.filteredProducts[Number(button.dataset.index)];
      if (!product) return;
      try {
        if (button.dataset.action === 'edit') this.editProduct(product.code);
        if (button.dataset.action === 'delete') await this.deleteProduct(product.code);
      } catch (error) { showToast(error.message, 'error'); }
    });
    document.getElementById('btn-add-product')
      ?.addEventListener('click', () => this.openAddForm());

    document.getElementById('inventory-search')
      ?.addEventListener('input', e => {
        this.searchTerm = e.target.value.toLowerCase();
        this.applyFilter();
      });

    document.getElementById('product-form')
      ?.addEventListener('submit', async e => {
        e.preventDefault();
        await this.handleProductFormSubmit();
      });
  }
}

const inventory = new InventoryManager();
