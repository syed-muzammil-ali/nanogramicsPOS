/**
 * PRELOAD SCRIPT - Secure API Bridge
 * 
 * Provides safe IPC communication between renderer and main process
 * using context isolation. Only whitelisted APIs are exposed.
 */

const { contextBridge, ipcRenderer } = require('electron');

// Whitelist of allowed IPC channels
const ALLOWED_CHANNELS = {
  'shop:issue': true,
  'shop:list': true,
  'shop:details': true,
  'shop:locations': true,
  'db:category:getAll': true,
  'db:category:add': true,
  'db:category:delete': true,
  // Database - Products
  'db:product:getAll': true,
  'db:product:getByCode': true,
  'db:product:add': true,
  'db:product:update': true,
  'db:product:delete': true,
  'db:product:updateStock': true,

  // Database - Sales
  'db:sale:create': true,
  'invoice:pdf:list': true,
  'invoice:pdf:generate': true,
  'invoice:pdf:open': true,
  'db:sale:getAll': true,
  'db:sale:getById': true,
  'db:sale:getByDateRange': true,
  'db:sale:delete': true,

  // Database - Users
  'db:user:add': true,
  'db:user:getAll': true,
  'db:user:authenticate': true,
  'db:user:logout': true,
  'db:user:update': true,
  'db:user:delete': true,

  // Database - Reports
  'db:report:getSalesReport': true,

  // Database - Settings
  'db:setting:get': true,
  'db:setting:set': true,

  // Database - Online Orders
  'db:onlineOrder:create': true,
  'db:onlineOrder:getAll': true,
  'db:onlineOrder:getByDate': true,
  'db:onlineOrder:updateStatus': true,   // ← STATUS UPDATE
  'db:onlineOrder:delete': true,         // ← DELETE ORDER
  'db:onlineOrder:getByDateRange': true,  // ← DATE RANGE
  'db:onlineOrder:update': true,         // ← UPDATE ORDER (for editing)
  'db:onlineOrder:bulkUpdateStatus': true, // ← BULK STATUS UPDATE
  'db:report:getFullReport': true,        // ← FULL COMBINED REPORT
  'db:report:getUserPerformance': true,   // ← USER PERFORMANCE

  // Database - Returns
  'db:return:process': true,
  'db:return:getList': true,
  'db:return:getInvoice': true,
  'db:simpleOnlineReturn:process': true,  // ← NEW: Simple online return (no order linking)
  'db:simpleOnlineReturn:getList': true,  // ← NEW: Get simple online returns list

  // Database - Exchanges
  'db:exchange:process': true,
  'db:exchange:getList': true,

  // Auditing
  'db:audit:log': true,
  'db:audit:getLogs': true,
  'db:audit:clearOld': true,

  // Dialogs
  'dialog:showSave': true,
  'dialog:showMessageBox': true,
  'db:backup:create': true,
  'print:receipt-silent': true
};

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: async (channel, ...args) => {
    if (!ALLOWED_CHANNELS[channel]) {
      throw new Error(`IPC channel "${channel}" is not allowed`);
    }
    try {
      return await ipcRenderer.invoke(channel, ...args);
    } catch (error) {
      console.error(`IPC Error on channel ${channel}:`, error);
      throw error;
    }
  },

  once: (channel, callback) => {
    ipcRenderer.once(channel, (event, ...args) => callback(...args));
  },

  on: (channel, callback) => {
    ipcRenderer.on(channel, (event, ...args) => callback(...args));
  },

  off: (channel, callback) => {
    ipcRenderer.off(channel, callback);
  }
});

contextBridge.exposeInMainWorld('appVersion', {
  version: '2.0.0',
  platform: process.platform
});
