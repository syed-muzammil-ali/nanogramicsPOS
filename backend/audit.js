/**
 * BACKEND AUDIT SERVICE
 * Handles audit logging for all system actions
 */

class AuditService {
  constructor(db) {
    this.db = db;
  }

  /**
   * Log an audit entry
   * @param {Object} entry - Audit entry data
   * @param {string} entry.action - Action performed (e.g. "Login", "Order Created")
   * @param {number} entry.userId - User ID
   * @param {string} entry.username - Username
   * @param {string} entry.userRole - User role (admin/cashier)
   * @param {string} entry.systemType - "Online" or "Offline"
   * @param {string} entry.invoiceNumber - Invoice/Order number (optional)
   * @param {string} entry.customerName - Customer name (optional)
   * @param {string} entry.details - Additional details (optional)
   */
  async log(entry) {
    try {
      const sql = `
        INSERT INTO audit_log 
        (timestamp, user_id, username, user_role, system_type, action, invoice_number, customer_name, details, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const now = new Date().toISOString();
      const timestamp = entry.timestamp || now;

      const result = await this.db.exec(sql, [
        timestamp,
        entry.userId || 0,
        entry.username || 'System',
        entry.userRole || 'system',
        entry.systemType || 'Offline',
        entry.action || 'Unknown Action',
        entry.invoiceNumber || '',
        entry.customerName || '',
        entry.details || '',
        now
      ]);

      console.log(`📝 Audit: ${entry.action} by ${entry.username}`);
      return result;
    } catch (error) {
      console.error('Audit log error:', error);
      // Don't throw - audit logging should not break the main flow
      return { success: false, error: error.message };
    }
  }

  /**
   * Get audit logs with filters
   */
  async getLogs(filters = {}) {
    let sql = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];
    
    if (filters.startDate) {
      sql += ' AND date(created_at) >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ' AND date(created_at) <= ?';
      params.push(filters.endDate);
    }
    if (filters.userId) {
      sql += ' AND user_id = ?';
      params.push(filters.userId);
    }
    if (filters.action) {
      sql += ' AND action LIKE ?';
      params.push(`%${filters.action}%`);
    }
    if (filters.username) {
      sql += ' AND username LIKE ?';
      params.push(`%${filters.username}%`);
    }
    
    sql += ' ORDER BY created_at DESC LIMIT 500';
    return await this.db.queryRows(sql, params);
  }

  /**
   * Clear old audit logs
   */
  async clearOldLogs(days = 90) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const result = await this.db.exec(
      'DELETE FROM audit_log WHERE created_at < ?',
      [cutoff.toISOString()]
    );
    return result;
  }

  /**
   * Get audit log statistics
   */
  async getStats(filters = {}) {
    let sql = `
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT username) as uniqueUsers,
        COUNT(DISTINCT action) as uniqueActions
      FROM audit_log WHERE 1=1
    `;
    const params = [];

    if (filters.startDate) {
      sql += ' AND date(created_at) >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ' AND date(created_at) <= ?';
      params.push(filters.endDate);
    }

    const results = await this.db.queryRows(sql, params);
    return results[0] || { total: 0, uniqueUsers: 0, uniqueActions: 0 };
  }

  /**
   * Get action breakdown
   */
  async getActionBreakdown(filters = {}) {
    let sql = `
      SELECT 
        action,
        COUNT(*) as count
      FROM audit_log WHERE 1=1
    `;
    const params = [];

    if (filters.startDate) {
      sql += ' AND date(created_at) >= ?';
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      sql += ' AND date(created_at) <= ?';
      params.push(filters.endDate);
    }

    sql += ' GROUP BY action ORDER BY count DESC LIMIT 20';
    return await this.db.queryRows(sql, params);
  }
}

module.exports = AuditService;