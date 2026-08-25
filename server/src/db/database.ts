import { DatabaseSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';
import { config } from '../config/env.js';

// Ensure data directory exists
if (!fs.existsSync(config.dataDir)) {
  fs.mkdirSync(config.dataDir, { recursive: true });
}

const dbPath = path.join(config.dataDir, 'shoreline.db');
export const db = new DatabaseSync(dbPath);

export function initDatabase() {
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
      ad_dn TEXT,
      last_login_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      icon TEXT DEFAULT 'folder.fill',
      color TEXT DEFAULT '#3b82f6',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL CHECK (protocol IN ('rdp', 'vnc', 'ssh')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      encrypted_credentials TEXT NOT NULL,
      parameters TEXT DEFAULT '{}',
      folder_id TEXT,
      is_favorite INTEGER DEFAULT 0,
      owner_id TEXT NOT NULL,
      created_by_admin_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE SET NULL,
      FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_admin_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS device_shares (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      shared_with_user_id TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
      FOREIGN KEY (shared_with_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE (device_id, shared_with_user_id)
    );

    CREATE TABLE IF NOT EXISTS guest_shares (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      device_id TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      pin_hash TEXT,
      duration_label TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      max_uses INTEGER,
      use_count INTEGER DEFAULT 0,
      revoked_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_logs (
      id TEXT PRIMARY KEY,
      session_id TEXT UNIQUE NOT NULL,
      user_id TEXT,
      guest_share_id TEXT,
      device_id TEXT NOT NULL,
      device_name TEXT NOT NULL,
      protocol TEXT NOT NULL,
      connection_method TEXT NOT NULL CHECK (connection_method IN ('owner', 'shared_user', 'guest_link')),
      client_ip TEXT,
      user_agent TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'closed', 'failed')),
      error_message TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (guest_share_id) REFERENCES guest_shares(id) ON DELETE SET NULL,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Initialize default settings if not exists
  const insertSetting = db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)');
  insertSetting.run('ad_domain', config.ad.domain);
  insertSetting.run('ad_url', config.ad.url);
  insertSetting.run('ad_base_dn', config.ad.baseDn);
  insertSetting.run('ad_admin_group', config.ad.adminGroup);
  insertSetting.run('ad_user_group', config.ad.userGroup);
  insertSetting.run('git_repo_url', config.git.repoUrl);
  insertSetting.run('git_branch', config.git.branch);

  console.log('✅ SQLite Database initialized at:', dbPath);
}
