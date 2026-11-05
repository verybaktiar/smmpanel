'use strict';

const db = require('./db');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

/**
 * Backup & Recovery System
 * Automatic database backups and configuration recovery
 */

class BackupSystem {
  constructor() {
    this.backupDir = path.join(__dirname, '..', 'backups');
    this.maxBackups = parseInt(process.env.MAX_BACKUPS) || 30; // Keep last 30 backups
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Create full backup (database + config + uploads)
   */
  async createBackup(type = 'manual') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup_${type}_${timestamp}`;
    const backupPath = path.join(this.backupDir, backupName);
    
    fs.mkdirSync(backupPath, { recursive: true });
    
    console.log(`[backup] Creating backup: ${backupName}`);
    
    const manifest = {
      type,
      timestamp: new Date().toISOString(),
      items: []
    };

    try {
      // Backup database
      await this.backupDatabase(backupPath);
      manifest.items.push('database.db');
      
      // Backup .env file
      await this.backupFile('.env', backupPath);
      manifest.items.push('.env');
      
      // Backup uploads directory
      await this.backupDirectory('uploads', backupPath);
      manifest.items.push('uploads/');
      
      // Backup sessions (browser profiles)
      await this.backupDirectory('sessions', backupPath);
      manifest.items.push('sessions/');
      
      // Write manifest
      fs.writeFileSync(
        path.join(backupPath, 'manifest.json'),
        JSON.stringify(manifest, null, 2)
      );
      
      console.log(`[backup] Backup created successfully: ${backupName}`);
      
      // Cleanup old backups
      await this.cleanupOldBackups();
      
      return {
        success: true,
        backupName,
        path: backupPath,
        size: await this.getDirectorySize(backupPath)
      };
    } catch (error) {
      console.error(`[backup] Error creating backup:`, error);
      throw error;
    }
  }

  /**
   * Backup database
   */
  async backupDatabase(backupPath) {
    const dbPath = path.join(__dirname, '..', 'database.db');
    
    if (!fs.existsSync(dbPath)) {
      console.log('[backup] No database file found');
      return;
    }
    
    const destPath = path.join(backupPath, 'database.db');
    fs.copyFileSync(dbPath, destPath);
    
    console.log('[backup] Database backed up');
  }

  /**
   * Backup single file
   */
  async backupFile(filename, backupPath) {
    const sourcePath = path.join(__dirname, '..', filename);
    
    if (!fs.existsSync(sourcePath)) {
      console.log(`[backup] File not found: ${filename}`);
      return;
    }
    
    const destPath = path.join(backupPath, filename);
    fs.copyFileSync(sourcePath, destPath);
    
    console.log(`[backup] File backed up: ${filename}`);
  }

  /**
   * Backup directory recursively
   */
  async backupDirectory(dirname, backupPath) {
    const sourcePath = path.join(__dirname, '..', dirname);
    
    if (!fs.existsSync(sourcePath)) {
      console.log(`[backup] Directory not found: ${dirname}`);
      return;
    }
    
    const destPath = path.join(backupPath, dirname);
    await this.copyDirectory(sourcePath, destPath);
    
    console.log(`[backup] Directory backed up: ${dirname}`);
  }

  /**
   * Copy directory recursively
   */
  async copyDirectory(source, destination) {
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }
    
    const entries = fs.readdirSync(source, { withFileTypes: true });
    
    for (const entry of entries) {
      const sourcePath = path.join(source, entry.name);
      const destPath = path.join(destination, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectory(sourcePath, destPath);
      } else {
        fs.copyFileSync(sourcePath, destPath);
      }
    }
  }

  /**
   * Restore from backup
   */
  async restoreBackup(backupName) {
    const backupPath = path.join(this.backupDir, backupName);
    
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupName}`);
    }
    
    console.log(`[backup] Restoring from: ${backupName}`);
    
    // Read manifest
    const manifestPath = path.join(backupPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Invalid backup: manifest.json not found');
    }
    
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    try {
      // Restore database
      if (manifest.items.includes('database.db')) {
        await this.restoreDatabase(backupPath);
      }
      
      // Restore .env
      if (manifest.items.includes('.env')) {
        await this.restoreFile('.env', backupPath);
      }
      
      // Restore uploads
      if (manifest.items.includes('uploads/')) {
        await this.restoreDirectory('uploads', backupPath);
      }
      
      // Restore sessions
      if (manifest.items.includes('sessions/')) {
        await this.restoreDirectory('sessions', backupPath);
      }
      
      console.log(`[backup] Restore completed successfully`);
      
      return {
        success: true,
        backupName,
        manifest
      };
    } catch (error) {
      console.error(`[backup] Error restoring backup:`, error);
      throw error;
    }
  }

  /**
   * Restore database
   */
  async restoreDatabase(backupPath) {
    const sourcePath = path.join(backupPath, 'database.db');
    const destPath = path.join(__dirname, '..', 'database.db');
    
    // Create backup of current database
    if (fs.existsSync(destPath)) {
      const backupTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const currentBackupPath = path.join(__dirname, '..', `database.backup.${backupTimestamp}.db`);
      fs.copyFileSync(destPath, currentBackupPath);
      console.log(`[backup] Current database backed up to: database.backup.${backupTimestamp}.db`);
    }
    
    fs.copyFileSync(sourcePath, destPath);
    console.log('[backup] Database restored');
  }

  /**
   * Restore file
   */
  async restoreFile(filename, backupPath) {
    const sourcePath = path.join(backupPath, filename);
    const destPath = path.join(__dirname, '..', filename);
    
    if (!fs.existsSync(sourcePath)) {
      console.log(`[backup] File not in backup: ${filename}`);
      return;
    }
    
    fs.copyFileSync(sourcePath, destPath);
    console.log(`[backup] File restored: ${filename}`);
  }

  /**
   * Restore directory
   */
  async restoreDirectory(dirname, backupPath) {
    const sourcePath = path.join(backupPath, dirname);
    const destPath = path.join(__dirname, '..', dirname);
    
    if (!fs.existsSync(sourcePath)) {
      console.log(`[backup] Directory not in backup: ${dirname}`);
      return;
    }
    
    // Remove destination if exists
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true, force: true });
    }
    
    await this.copyDirectory(sourcePath, destPath);
    console.log(`[backup] Directory restored: ${dirname}`);
  }

  /**
   * List all backups
   */
  async listBackups() {
    const entries = fs.readdirSync(this.backupDir, { withFileTypes: true });
    const backups = [];
    
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('backup_')) {
        const backupPath = path.join(this.backupDir, entry.name);
        const manifestPath = path.join(backupPath, 'manifest.json');
        
        let manifest = null;
        if (fs.existsSync(manifestPath)) {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        }
        
        backups.push({
          name: entry.name,
          path: backupPath,
          size: await this.getDirectorySize(backupPath),
          created: manifest ? manifest.timestamp : null,
          type: manifest ? manifest.type : 'unknown',
          items: manifest ? manifest.items : []
        });
      }
    }
    
    // Sort by creation date (newest first)
    backups.sort((a, b) => {
      if (!a.created || !b.created) return 0;
      return new Date(b.created) - new Date(a.created);
    });
    
    return backups;
  }

  /**
   * Delete backup
   */
  async deleteBackup(backupName) {
    const backupPath = path.join(this.backupDir, backupName);
    
    if (!fs.existsSync(backupPath)) {
      throw new Error(`Backup not found: ${backupName}`);
    }
    
    fs.rmSync(backupPath, { recursive: true, force: true });
    console.log(`[backup] Deleted backup: ${backupName}`);
    
    return { success: true };
  }

  /**
   * Cleanup old backups
   */
  async cleanupOldBackups() {
    const backups = await this.listBackups();
    
    if (backups.length <= this.maxBackups) {
      return { deleted: 0 };
    }
    
    const toDelete = backups.slice(this.maxBackups);
    
    for (const backup of toDelete) {
      await this.deleteBackup(backup.name);
    }
    
    console.log(`[backup] Cleaned up ${toDelete.length} old backups`);
    
    return { deleted: toDelete.length };
  }

  /**
   * Get directory size
   */
  async getDirectorySize(dirPath) {
    let totalSize = 0;
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      if (entry.isDirectory()) {
        totalSize += await this.getDirectorySize(fullPath);
      } else {
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
      }
    }
    
    return totalSize;
  }

  /**
   * Format size for display
   */
  formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Export configuration
   */
  async exportConfig() {
    await db.waitReady();
    
    const config = {
      accounts: await db.rawAll('SELECT * FROM accounts'),
      proxies: await db.rawAll('SELECT * FROM proxies'),
      schedules: await db.rawAll('SELECT * FROM schedules'),
      templates: await db.rawAll('SELECT * FROM content_templates').catch(() => []),
      exported_at: new Date().toISOString()
    };
    
    // Remove sensitive data
    config.accounts = config.accounts.map(acc => ({
      ...acc,
      password_enc: '[ENCRYPTED]'
    }));
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `config_export_${timestamp}.json`;
    const filepath = path.join(this.backupDir, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(config, null, 2));
    
    console.log(`[backup] Config exported: ${filename}`);
    
    return {
      success: true,
      filename,
      path: filepath
    };
  }
}

module.exports = new BackupSystem();
