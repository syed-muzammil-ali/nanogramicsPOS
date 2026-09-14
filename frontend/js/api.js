/**
 * API BRIDGE MODULE
 * 
 * Handles all communication with main process via IPC
 * Abstracts database operations into clean API
 * All calls are async and error-safe
 */

class APIBridge {
  /**
   * Check if Electron API is available
   */
  static isAvailable() {
    return typeof window.electronAPI !== 'undefined';
  }

  /**
   * Generic invoke method with error handling
   */
  static async invoke(channel, ...args) {
    try {
      if (!this.isAvailable()) {
        throw new Error('Electron API not available');
      }
      return await window.electronAPI.invoke(channel, ...args);
    } catch (error) {
      console.error(`IPC Error [${channel}]:`, error);
      throw error;
    }
  }

  // ════════════════════════════════════════════════════════════
  // PRODUCTS API
  // ════════════════════════════════════════════════════════════

  static async getCategories() { return this.invoke('db:category:getAll'); }
  static async addCategory(name) { return this.invoke('db:category:add', name); }
  static async deleteCategory(id) { return this.invoke('db:category:delete', id); }

  static async getProducts() {
    return await this.invoke('db:product:getAll');
  }

  static async getProductByCode(code) {
    const result = await this.invoke('db:product:getByCode', code);
    return result.length > 0 ? result[0] : null;
  }

  static async addProduct(product) {
    return await this.invoke('db:product:add', product);
  }

  static async updateProduct(product) {
    return await this.invoke('db:product:update', product);
  }

  static async deleteProduct(code) {
    return await this.invoke('db:product:delete', code);
  }

  static async updateProductStock(code, qty) {
    return await this.invoke('db:product:updateStock', code, qty);
  }

  // ════════════════════════════════════════════════════════════
  // SALES API
  // ════════════════════════════════════════════════════════════

  static async createSale(sale) {
    return await this.invoke('db:sale:create', sale);
  }

  static async getSales() {
    return await this.invoke('db:sale:getAll');
  }

  static async getSaleById(id) {
    return await this.invoke('db:sale:getById', id);
  }

  static async getSalesByDateRange(startDate, endDate) {
    return await this.invoke('db:sale:getByDateRange', startDate, endDate);
  }

  static async deleteSale(saleId) {
    return await this.invoke('db:sale:delete', saleId);
  }

  // ════════════════════════════════════════════════════════════
  // USERS API
  // ════════════════════════════════════════════════════════════

  static async getUsers() {
    return await this.invoke('db:user:getAll');
  }

  static async addUser(user) {
    return await this.invoke('db:user:add', user);
  }

  static async updateUser(userId, updates) {
    return await this.invoke('db:user:update', userId, updates);
  }

  static async deleteUser(userId) {
    return await this.invoke('db:user:delete', userId);
  }

  static async authenticate(username, password) {
    return await this.invoke('db:user:authenticate', username, password);
  }

  static async logoutUser() {
    return await this.invoke('db:user:logout');
  }

  // ════════════════════════════════════════════════════════════
  // REPORTS API
  // ════════════════════════════════════════════════════════════

  static async getSalesReport(startDate, endDate) {
    return await this.invoke('db:report:getSalesReport', startDate, endDate);
  }

  // ════════════════════════════════════════════════════════════
  // SETTINGS API
  // ════════════════════════════════════════════════════════════

  static async getSetting(key) {
    return await this.invoke('db:setting:get', key);
  }

  static async setSetting(key, value) {
    return await this.invoke('db:setting:set', key, value);
  }

  // ════════════════════════════════════════════════════════════
  // ONLINE ORDERS API
  // ════════════════════════════════════════════════════════════

  static async createOnlineOrder(order) {
    return await this.invoke('db:onlineOrder:create', order);
  }

  static async getOnlineOrders() {
    return await this.invoke('db:onlineOrder:getAll');
  }

  static async getOnlineOrdersByDate(dateStr) {
    return await this.invoke('db:onlineOrder:getByDate', dateStr);
  }

  static async getOnlineOrdersByDateRange(startDate, endDate) {
    return await this.invoke('db:onlineOrder:getByDateRange', startDate, endDate);
  }

  static async getFullReport(startDate, endDate) {
    return await this.invoke('db:report:getFullReport', startDate, endDate);
  }

  static async getUserPerformance(startDate, endDate) {
    return await this.invoke('db:report:getUserPerformance', startDate, endDate);
  }

  static async updateOnlineOrder(order) {
    return await this.invoke('db:onlineOrder:update', order);
  }

  static async updateOnlineOrderStatus(orderId, status) {
    return await this.invoke('db:onlineOrder:updateStatus', orderId, status);
  }

  static async bulkUpdateOnlineOrderStatus(orderIds, status) {
    return await this.invoke('db:onlineOrder:bulkUpdateStatus', orderIds, status);
  }

  static async deleteOnlineOrder(orderId) {
    return await this.invoke('db:onlineOrder:delete', orderId);
  }

  // ════════════════════════════════════════════════════════════
  // RETURNS API
  // ════════════════════════════════════════════════════════════

  static async processReturn(returnData) {
    console.log('API: processReturn called with:', returnData);
    try {
      const result = await this.invoke('db:return:process', returnData);
      console.log('API: processReturn result:', result);
      return result;
    } catch (error) {
      console.error('API: processReturn error:', error);
      throw error;
    }
  }

  static async getReturnsList() {
    console.log('API: getReturnsList called');
    try {
      const result = await this.invoke('db:return:getList');
      console.log('API: getReturnsList result:', result);
      return result;
    } catch (error) {
      console.error('API: getReturnsList error:', error);
      return [];
    }
  }

  static async getInvoiceForReturn(invoiceId) {
    console.log('API: getInvoiceForReturn called with:', invoiceId);
    try {
      const result = await this.invoke('db:return:getInvoice', invoiceId);
      console.log('API: getInvoiceForReturn result:', result);
      return result;
    } catch (error) {
      console.error('API: getInvoiceForReturn error:', error);
      throw error;
    }
  }

  // ── SIMPLE ONLINE RETURN PROCESSING ───────────────────────
  // For simple online returns with just total pieces and amount (no order linking)
  static async processSimpleOnlineReturn(returnData) {
    console.log('API: processSimpleOnlineReturn called with:', returnData);
    try {
      const result = await this.invoke('db:simpleOnlineReturn:process', returnData);
      console.log('API: processSimpleOnlineReturn result:', result);
      return result;
    } catch (error) {
      console.error('API: processSimpleOnlineReturn error:', error);
      throw error;
    }
  }

  // Get list of simple online returns
  static async getSimpleOnlineReturnsList() {
    console.log('API: getSimpleOnlineReturnsList called');
    try {
      const result = await this.invoke('db:simpleOnlineReturn:getList');
      console.log('API: getSimpleOnlineReturnsList result:', result);
      return result;
    } catch (error) {
      console.error('API: getSimpleOnlineReturnsList error:', error);
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════
  // EXCHANGES API
  // ════════════════════════════════════════════════════════════

  static async processExchange(data) {
    console.log('API: processExchange called with:', data);
    try {
      const result = await this.invoke('db:exchange:process', data);
      console.log('API: processExchange result:', result);
      return result;
    } catch (error) {
      console.error('API: processExchange error:', error);
      throw error;
    }
  }

  static async getExchangesList() {
    console.log('API: getExchangesList called');
    try {
      const result = await this.invoke('db:exchange:getList');
      console.log('API: getExchangesList result:', result);
      return result;
    } catch (error) {
      console.error('API: getExchangesList error:', error);
      return [];
    }
  }

  // ════════════════════════════════════════════════════════════
  // AUDIT LOG API
  // ════════════════════════════════════════════════════════════

  static async getAuditLogs(filters = {}) {
    return await this.invoke('db:audit:getLogs', filters);
  }

  static async clearOldAuditLogs(days = 90) {
    return await this.invoke('db:audit:clearOld', days);
  }

  static async logAuditEntry(entry) {
    return await this.invoke('db:audit:log', entry);
  }

  // ════════════════════════════════════════════════════════════
  // DIALOG API
  // ════════════════════════════════════════════════════════════

  static async showSaveDialog(options) {
    return await this.invoke('dialog:showSave', options);
  }

  static async showMessageBox(options) {
    return await this.invoke('dialog:showMessageBox', options);
  }

  static async createBackup() {
    return await this.invoke('db:backup:create');
  }
}

// Make API bridge global
window.API = APIBridge;