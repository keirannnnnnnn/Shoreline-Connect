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
      ad_groups TEXT,
      last_login_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    db.exec('ALTER TABLE users ADD COLUMN ad_groups TEXT;');
  } catch {}

  db.exec(`
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

    CREATE TABLE IF NOT EXISTS monitoring_agents (
      id TEXT PRIMARY KEY,
      device_id TEXT UNIQUE NOT NULL,
      token_hash TEXT NOT NULL,
      token_preview TEXT NOT NULL,
      token_encrypted TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'online', 'offline')),
      last_seen_at DATETIME,
      system_info TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_monitoring_agents_token_hash ON monitoring_agents(token_hash);
    CREATE INDEX IF NOT EXISTS idx_monitoring_agents_device ON monitoring_agents(device_id);

    CREATE TABLE IF NOT EXISTS monitoring_metrics_raw (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      cpu_usage REAL NOT NULL,
      cpu_per_core TEXT,
      ram_used INTEGER NOT NULL,
      ram_total INTEGER NOT NULL,
      ram_percent REAL NOT NULL,
      swap_used INTEGER,
      swap_total INTEGER,
      swap_percent REAL,
      disk_read_bytes_sec REAL,
      disk_write_bytes_sec REAL,
      net_rx_bytes_sec REAL,
      net_tx_bytes_sec REAL,
      cpu_temp REAL,
      load_1 REAL,
      load_5 REAL,
      load_15 REAL,
      uptime INTEGER,
      disks TEXT,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_raw_dev_time ON monitoring_metrics_raw(device_id, timestamp);

    CREATE TABLE IF NOT EXISTS monitoring_metrics_rollup_5m (
      device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      cpu_usage_avg REAL NOT NULL,
      cpu_usage_max REAL NOT NULL,
      ram_percent_avg REAL NOT NULL,
      disk_read_bytes_sec_avg REAL,
      disk_write_bytes_sec_avg REAL,
      net_rx_bytes_sec_avg REAL,
      net_tx_bytes_sec_avg REAL,
      cpu_temp_avg REAL,
      load_1_avg REAL,
      PRIMARY KEY (device_id, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_5m_dev_time ON monitoring_metrics_rollup_5m(device_id, timestamp);

    CREATE TABLE IF NOT EXISTS monitoring_metrics_rollup_1h (
      device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      cpu_usage_avg REAL NOT NULL,
      cpu_usage_max REAL NOT NULL,
      ram_percent_avg REAL NOT NULL,
      disk_read_bytes_sec_avg REAL,
      disk_write_bytes_sec_avg REAL,
      net_rx_bytes_sec_avg REAL,
      net_tx_bytes_sec_avg REAL,
      cpu_temp_avg REAL,
      load_1_avg REAL,
      PRIMARY KEY (device_id, timestamp)
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_1h_dev_time ON monitoring_metrics_rollup_1h(device_id, timestamp);

    CREATE TABLE IF NOT EXISTS user_dashboard_layouts (
      user_id TEXT PRIMARY KEY,
      layout_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    /* --- Build 2: Tracking Subsystem Schema --- */
    CREATE TABLE IF NOT EXISTS tracked_items (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('Vehicles', 'Devices')),
      user_id TEXT NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      movement_threshold_meters REAL DEFAULT 25.0,
      min_speed_kmh REAL DEFAULT 5.0,
      stationary_dwell_seconds INTEGER DEFAULT 300,
      last_lat REAL,
      last_lng REAL,
      last_speed REAL,
      last_heading REAL,
      last_accuracy REAL,
      last_battery REAL,
      status TEXT DEFAULT 'offline' CHECK (status IN ('moving', 'stationary', 'offline')),
      last_seen_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tracked_items_user ON tracked_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_tracked_items_token ON tracked_items(token_hash);

    CREATE TABLE IF NOT EXISTS tracking_journeys (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      start_lat REAL,
      start_lng REAL,
      end_lat REAL,
      end_lng REAL,
      distance_km REAL DEFAULT 0.0,
      duration_seconds INTEGER DEFAULT 0,
      avg_speed_kmh REAL DEFAULT 0.0,
      max_speed_kmh REAL DEFAULT 0.0,
      points_count INTEGER DEFAULT 0,
      has_speeding INTEGER DEFAULT 0,
      status TEXT DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (item_id) REFERENCES tracked_items(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_journeys_item_time ON tracking_journeys(item_id, start_time DESC);

    CREATE TABLE IF NOT EXISTS tracking_locations_raw (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      speed REAL,
      heading REAL,
      accuracy REAL,
      battery_level REAL,
      speed_limit REAL,
      road_name TEXT,
      is_speeding INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      journey_id TEXT,
      FOREIGN KEY (item_id) REFERENCES tracked_items(id) ON DELETE CASCADE,
      FOREIGN KEY (journey_id) REFERENCES tracking_journeys(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_loc_raw_item_time ON tracking_locations_raw(item_id, timestamp);
    CREATE INDEX IF NOT EXISTS idx_loc_raw_journey ON tracking_locations_raw(journey_id);

    CREATE TABLE IF NOT EXISTS tracking_locations_downsampled (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      speed REAL,
      heading REAL,
      speed_limit REAL,
      is_speeding INTEGER DEFAULT 0,
      timestamp INTEGER NOT NULL,
      journey_id TEXT,
      FOREIGN KEY (item_id) REFERENCES tracked_items(id) ON DELETE CASCADE,
      FOREIGN KEY (journey_id) REFERENCES tracking_journeys(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_loc_down_item_time ON tracking_locations_downsampled(item_id, timestamp);

    CREATE TABLE IF NOT EXISTS osm_speed_limits_cache (
      id TEXT PRIMARY KEY,
      lat_grid REAL NOT NULL,
      lng_grid REAL NOT NULL,
      speed_limit_kmh REAL NOT NULL,
      road_name TEXT,
      cached_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_osm_speed_grid ON osm_speed_limits_cache(lat_grid, lng_grid);
  `);

  // Initialize default settings if not exists
  const insertSetting = db.prepare('INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)');
  insertSetting.run('ad_domain', config.ad.domain);
  insertSetting.run('ad_url', config.ad.url);
  insertSetting.run('ad_base_dn', config.ad.baseDn);
  insertSetting.run('ad_admin_group', config.ad.adminGroup);
  insertSetting.run('ad_user_group', config.ad.userGroup);
  insertSetting.run('tab_group_devices', process.env.TAB_GROUP_DEVICES || '');
  insertSetting.run('tab_group_monitoring', process.env.TAB_GROUP_MONITORING || '');
  insertSetting.run('tab_group_tracking', process.env.TAB_GROUP_TRACKING || '');
  insertSetting.run('tab_group_cloud', process.env.TAB_GROUP_CLOUD || '');
  insertSetting.run('git_repo_url', config.git.repoUrl);
  insertSetting.run('git_branch', config.git.branch);
  insertSetting.run('monitoring_hub_url', process.env.MONITORING_HUB_URL || process.env.TAILSCALE_IP || '');
  insertSetting.run('tracking_map_provider', 'leaflet');
  insertSetting.run('google_maps_api_key', '');

  console.log('✅ SQLite Database initialized at:', dbPath);
}
