/**
 * BACKUP SERVICE
 * 
 * Handles:
 * - Automatic daily SQLite database backups
 * - Backup restoration
 * - Backup cleanup
 */

const fs = require('fs');
const path = require('path');

class BackupService {
  constructor(dbPath, backupDir) {
    this.dbPath = dbPath;
    this.backupDir = backupDir;
    this.backupInterval = null;
    this.maxBackups = 30; // Keep 30 days of backups
  }

  /**
   * Setup automatic backup (runs daily at 1 AM)
   */
  setupAutoBackup() {
    // Check if backup needed immediately
    if (this.shouldBackupToday()) {
      this.createBackup();
    }

    // Schedule daily backup at 1 AM
    const scheduleNextBackup = () => {
      const now = new Date();
      const target = new Date();
      target.setHours(1, 0, 0, 0);

      if (target <= now) {
        target.setDate(target.getDate() + 1);
      }

      const timeUntilBackup = target - now;
      
      this.backupInterval = setTimeout(() => {
        this.createBackup();
        scheduleNextBackup(); // Reschedule for next day
      }, timeUntilBackup);
    };

    scheduleNextBackup();
    console.log('Auto-backup scheduled');
  }

  /**
   * Check if backup already exists for today
   */
  shouldBackupToday() {
    const today = new Date().toISOString().split('T')[0];
    const todayBackup = path.join(this.backupDir, `backup_${today}.db`);
    return !fs.existsSync(todayBackup);
  }

  /**
   * Create a backup of the database
   */
  createBackup() {
    try {
      if (!fs.existsSync(this.dbPath)) {
        console.warn('Database file not found for backup');
        return null;
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const backupPath = path.join(this.backupDir, `backup_${timestamp}.db`);

      // Only create if it doesn't exist
      if (!fs.existsSync(backupPath)) {
        fs.copyFileSync(this.dbPath, backupPath);
        console.log(`Backup created: ${backupPath}`);
      }

      // Cleanup old backups
      this.cleanupOldBackups();

      return backupPath;
    } catch (error) {
      console.error('Backup creation failed:', error);
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Restore database from backup
   */
  restoreBackup(backupPath) {
    try {
      if (!fs.existsSync(backupPath)) {
        throw new Error('Backup file not found');
      }

      // Create backup of current database before restore
      const before = path.join(this.backupDir, `backup_before_restore_${new Date().getTime()}.db`);
      if (fs.existsSync(this.dbPath)) {
        fs.copyFileSync(this.dbPath, before);
      }

      // Restore from backup
      fs.copyFileSync(backupPath, this.dbPath);
      console.log(`Database restored from: ${backupPath}`);
      
      return {
        success: true,
        message: 'Database restored successfully',
        backupOf: before
      };
    } catch (error) {
      console.error('Backup restoration failed:', error);
      throw new Error(`Failed to restore backup: ${error.message}`);
    }
  }

  /**
   * Get list of all backups
   */
  listBackups() {
    try {
      const files = fs.readdirSync(this.backupDir);
      return files
        .filter(f => f.startsWith('backup_') && f.endsWith('.db'))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          date: f.match(/backup_(.+)\.db/)[1],
          size: fs.statSync(path.join(this.backupDir, f)).size
        }))
        .sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (error) {
      console.error('Failed to list backups:', error);
      return [];
    }
  }

  /**
   * Delete old backups keeping only the latest maxBackups
   */
  cleanupOldBackups() {
    try {
      const backups = this.listBackups();
      
      if (backups.length > this.maxBackups) {
        const toDelete = backups.slice(this.maxBackups);
        toDelete.forEach(backup => {
          fs.unlinkSync(backup.path);
          console.log(`Deleted old backup: ${backup.name}`);
        });
      }
    } catch (error) {
      console.error('Backup cleanup failed:', error);
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.backupInterval) {
      clearTimeout(this.backupInterval);
    }
  }
}

module.exports = BackupService;