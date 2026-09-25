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

    /* --- Build 3: Cloud Storage Schema --- */
    CREATE TABLE IF NOT EXISTS cloud_shares (
      id TEXT PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      share_type TEXT NOT NULL CHECK (share_type IN ('permanent', 'quick_link')),
      virtual_path TEXT,
      temp_filename TEXT,
      original_filename TEXT NOT NULL,
      file_size_bytes INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT 'application/octet-stream',
      pin_hash TEXT,
      expires_at INTEGER,
      revoked_at INTEGER,
      download_count INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cloud_shares_token ON cloud_shares(token);
    CREATE INDEX IF NOT EXISTS idx_cloud_shares_user ON cloud_shares(user_id);

    CREATE TABLE IF NOT EXISTS cloud_quick_link_audit (
      id TEXT PRIMARY KEY,
      share_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      filename TEXT NOT NULL,
      file_size_bytes INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      had_pin INTEGER DEFAULT 0,
      outcome TEXT DEFAULT 'active' CHECK (outcome IN ('active', 'expired', 'revoked')),
      revoked_at INTEGER,
      download_count INTEGER DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_cloud_audit_user ON cloud_quick_link_audit(user_id);
    CREATE INDEX IF NOT EXISTS idx_cloud_audit_share ON cloud_quick_link_audit(share_id);

    CREATE TABLE IF NOT EXISTS cloud_folder_metadata (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      color TEXT DEFAULT '#3b82f6',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, folder_path),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cloud_folder_meta ON cloud_folder_metadata(user_id, folder_path);

    /* --- Device Tags / Groups Subsystem --- */
    CREATE TABLE IF NOT EXISTS device_tags (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
      UNIQUE(device_id, tag)
    );

    CREATE INDEX IF NOT EXISTS idx_device_tags_dev ON device_tags(device_id);
    CREATE INDEX IF NOT EXISTS idx_device_tags_tag ON device_tags(tag);

    /* --- Build 4: Updates & Software Management Subsystem --- */
    CREATE TABLE IF NOT EXISTS software_inventory (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      software_key TEXT NOT NULL,
      name TEXT NOT NULL,
      version TEXT,
      publisher TEXT,
      install_date TEXT,
      arch TEXT,
      source TEXT NOT NULL,
      uninstall_string TEXT,
      quiet_uninstall_string TEXT,
      msi_product_code TEXT,
      is_per_user INTEGER DEFAULT 0,
      is_remotely_uninstallable INTEGER DEFAULT 1,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
      UNIQUE(device_id, software_key)
    );

    CREATE INDEX IF NOT EXISTS idx_sw_inv_device ON software_inventory(device_id);
    CREATE INDEX IF NOT EXISTS idx_sw_inv_name ON software_inventory(name);

    CREATE TABLE IF NOT EXISTS software_inventory_history (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      software_key TEXT NOT NULL,
      change_type TEXT NOT NULL CHECK (change_type IN ('added', 'removed', 'modified')),
      name TEXT NOT NULL,
      old_version TEXT,
      new_version TEXT,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sw_hist_device ON software_inventory_history(device_id, changed_at DESC);

    CREATE TABLE IF NOT EXISTS device_available_updates (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      name TEXT NOT NULL,
      current_version TEXT,
      available_version TEXT NOT NULL,
      package_identifier TEXT,
      source TEXT NOT NULL,
      is_security INTEGER DEFAULT 0,
      requires_reboot INTEGER DEFAULT 0,
      detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dev_avail_updates ON device_available_updates(device_id);

    CREATE TABLE IF NOT EXISTS update_pins (
      id TEXT PRIMARY KEY,
      device_id TEXT,
      app_name TEXT NOT NULL,
      pin_type TEXT NOT NULL CHECK (pin_type IN ('ignore', 'pin_version')),
      pinned_version TEXT,
      reason TEXT,
      created_by_user_id TEXT,
      created_by_username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_update_pins_app ON update_pins(app_name);

    CREATE TABLE IF NOT EXISTS update_packages (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      description TEXT,
      package_source_type TEXT NOT NULL CHECK (package_source_type IN ('file', 'winget', 'apt')),
      winget_id TEXT,
      apt_package_name TEXT,
      created_by_user_id TEXT,
      created_by_username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS update_package_versions (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      version TEXT NOT NULL,
      target_os TEXT NOT NULL CHECK (target_os IN ('windows', 'linux', 'all')),
      target_arch TEXT NOT NULL CHECK (target_arch IN ('amd64', 'arm64', 'all')),
      file_path TEXT,
      file_sha256 TEXT,
      file_size_bytes INTEGER DEFAULT 0,
      silent_install_args TEXT,
      uninstall_command TEXT,
      expected_exit_codes TEXT DEFAULT '0,3010,1641',
      detection_name TEXT,
      detection_version TEXT,
      notes TEXT,
      created_by_user_id TEXT,
      created_by_username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (package_id) REFERENCES update_packages(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(package_id, version, target_os, target_arch)
    );

    CREATE INDEX IF NOT EXISTS idx_pkg_ver_pkg ON update_package_versions(package_id);

    CREATE TABLE IF NOT EXISTS update_jobs (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      job_type TEXT NOT NULL CHECK (job_type IN ('inventory_scan', 'check_updates', 'install', 'uninstall', 'upgrade', 'agent_update', 'run_script')),
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'waiting_for_device', 'sent', 'downloading', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'succeeded_not_detected')),
      payload_json TEXT NOT NULL,
      exit_code INTEGER,
      stdout TEXT,
      stderr TEXT,
      reboot_required INTEGER DEFAULT 0,
      detection_matched INTEGER,
      timeout_seconds INTEGER DEFAULT 1800,
      expires_at DATETIME,
      created_by_user_id TEXT,
      created_by_username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_update_jobs_dev_status ON update_jobs(device_id, status);
    CREATE INDEX IF NOT EXISTS idx_update_jobs_created ON update_jobs(created_at DESC);

    CREATE TABLE IF NOT EXISTS update_agent_builds (
      id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      target_os TEXT NOT NULL CHECK (target_os IN ('windows', 'linux')),
      target_arch TEXT NOT NULL CHECK (target_arch IN ('amd64', 'arm64')),
      file_path TEXT NOT NULL,
      file_sha256 TEXT NOT NULL,
      file_size_bytes INTEGER DEFAULT 0,
      is_install_default INTEGER DEFAULT 0,
      notes TEXT,
      created_by_user_id TEXT,
      created_by_username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_agent_builds_os_arch ON update_agent_builds(target_os, target_arch);

    CREATE TABLE IF NOT EXISTS update_scripts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      target_os TEXT NOT NULL CHECK (target_os IN ('windows', 'linux', 'all')),
      script_type TEXT NOT NULL CHECK (script_type IN ('powershell', 'batch', 'bash')),
      timeout_seconds INTEGER DEFAULT 600,
      parameters_schema_json TEXT,
      is_archived INTEGER DEFAULT 0,
      created_by_user_id TEXT,
      created_by_username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS update_script_versions (
      id TEXT PRIMARY KEY,
      script_id TEXT NOT NULL,
      version_num INTEGER NOT NULL,
      script_content TEXT NOT NULL,
      notes TEXT,
      created_by_user_id TEXT,
      created_by_username TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (script_id) REFERENCES update_scripts(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE(script_id, version_num)
    );

    CREATE INDEX IF NOT EXISTS idx_script_ver_script ON update_script_versions(script_id, version_num DESC);

    CREATE TABLE IF NOT EXISTS update_audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      device_id TEXT,
      device_name TEXT,
      package_id TEXT,
      details_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_update_audit_time ON update_audit_logs(created_at DESC);
  `);

  try {
    db.exec('ALTER TABLE monitoring_agents ADD COLUMN agent_version TEXT;');
  } catch {}

  try {
    db.exec('ALTER TABLE device_available_updates ADD COLUMN package_identifier TEXT;');
  } catch {}

  // Migrate update_jobs table if needed
  try {
    const tableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='update_jobs'").get() as { sql: string } | undefined;
    if (tableInfo?.sql && !tableInfo.sql.includes('succeeded_not_detected')) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS update_jobs_migration (
          id TEXT PRIMARY KEY,
          device_id TEXT NOT NULL,
          job_type TEXT NOT NULL CHECK (job_type IN ('inventory_scan', 'check_updates', 'install', 'uninstall', 'upgrade', 'agent_update', 'run_script')),
          status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'waiting_for_device', 'sent', 'downloading', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'succeeded_not_detected')),
          payload_json TEXT NOT NULL,
          exit_code INTEGER,
          stdout TEXT,
          stderr TEXT,
          reboot_required INTEGER DEFAULT 0,
          detection_matched INTEGER,
          timeout_seconds INTEGER DEFAULT 1800,
          expires_at DATETIME,
          created_by_user_id TEXT,
          created_by_username TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          started_at DATETIME,
          completed_at DATETIME,
          FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
          FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        INSERT OR IGNORE INTO update_jobs_migration SELECT * FROM update_jobs;
        DROP TABLE update_jobs;
        ALTER TABLE update_jobs_migration RENAME TO update_jobs;
        CREATE INDEX IF NOT EXISTS idx_update_jobs_dev_status ON update_jobs(device_id, status);
        CREATE INDEX IF NOT EXISTS idx_update_jobs_created ON update_jobs(created_at DESC);
      `);
    }
  } catch {}

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
  insertSetting.run('tab_group_updates', 'Shoreline Connect Updates Users');
  insertSetting.run('git_repo_url', config.git.repoUrl);
  insertSetting.run('git_branch', config.git.branch);
  insertSetting.run('monitoring_hub_url', process.env.MONITORING_HUB_URL || process.env.TAILSCALE_IP || '');
  insertSetting.run('tracking_map_provider', 'leaflet');
  insertSetting.run('google_maps_api_key', '');
  insertSetting.run('cloud_storage_base_path', '');
  insertSetting.run('updates_fleet_concurrency', '5');
  insertSetting.run('updates_inventory_scan_interval_minutes', '60');
  insertSetting.run('updates_detection_interval_minutes', '60');

  // Ensure tab_group_updates is not blank on migration
  try {
    const curTabUpdates = db.prepare("SELECT value FROM system_settings WHERE key = 'tab_group_updates'").get() as { value: string } | undefined;
    if (!curTabUpdates || !curTabUpdates.value || curTabUpdates.value.trim() === '') {
      db.prepare("INSERT OR REPLACE INTO system_settings (key, value) VALUES ('tab_group_updates', 'Shoreline Connect Updates Users')").run();
    }
  } catch {}

  console.log('✅ SQLite Database initialized at:', dbPath);
}
