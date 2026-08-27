import crypto from 'crypto';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';
import { db } from '../db/database.js';
import { CryptoService } from './crypto.service.js';
import { DeviceService } from './device.service.js';

export interface MonitoringAgentRecord {
  id: string;
  device_id: string;
  token_hash: string;
  token_preview: string;
  token_encrypted: string;
  status: 'pending' | 'online' | 'offline';
  last_seen_at: string | null;
  system_info: string | null;
  created_at: string;
  updated_at: string;
}

export interface IngestMetricPayload {
  timestamp: number;
  cpu_usage: number;
  cpu_per_core?: number[];
  ram_used: number;
  ram_total: number;
  ram_percent: number;
  swap_used?: number;
  swap_total?: number;
  swap_percent?: number;
  disk_read_bytes_sec?: number;
  disk_write_bytes_sec?: number;
  net_rx_bytes_sec?: number;
  net_tx_bytes_sec?: number;
  cpu_temp?: number | null;
  load_1?: number | null;
  load_5?: number | null;
  load_15?: number | null;
  uptime?: number;
  disks?: Array<{
    mount_point: string;
    device: string;
    fs_type: string;
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    used_pct: number;
  }>;
  system_info?: {
    hostname: string;
    os: string;
    platform: string;
    platform_version: string;
    kernel: string;
    arch: string;
    cpu_model: string;
    cpu_cores: number;
    total_ram: number;
    total_disk: number;
    agent_version: string;
    disks?: any[];
  };
}

export interface MonitoredDeviceSummary {
  id: string;
  device_id: string;
  device_name: string;
  protocol: 'rdp' | 'vnc' | 'ssh';
  host: string;
  is_shared: boolean;
  shared_by_user?: string;
  status: 'pending' | 'online' | 'offline';
  last_seen_at: string | null;
  system_info: any | null;
  current_metrics: {
    cpu_usage: number;
    ram_percent: number;
    ram_used: number;
    ram_total: number;
    disk_percent: number;
    net_rx_bytes_sec: number;
    net_tx_bytes_sec: number;
    cpu_temp: number | null;
    uptime: number;
  } | null;
}

export class MonitoringService {
  private static rollupTimer: NodeJS.Timeout | null = null;

  /**
   * Start the background metrics rollup and retention pruning job (runs every 5 minutes)
   */
  static startBackgroundJob() {
    if (this.rollupTimer) return;
    
    // Run immediately once on server boot
    this.runRollupAndRetention();

    this.rollupTimer = setInterval(() => {
      this.runRollupAndRetention();
    }, 5 * 60 * 1000);

    console.log('✅ Monitoring Rollup & 120-Day Retention engine started (interval: 5m)');
  }

  /**
   * Auto-detect host's Tailscale IPv4 address (CGNAT 100.64.0.0/10 or tailscale interface)
   */
  static detectTailscaleIp(): string | null {
    try {
      const ifaces = os.networkInterfaces();
      for (const [name, addrs] of Object.entries(ifaces)) {
        if (!addrs) continue;
        const lowerName = name.toLowerCase();
        for (const addr of addrs) {
          if (addr.family === 'IPv4' && !addr.internal) {
            // 1. Interface name match (e.g. tailscale0, ts0)
            if (lowerName.includes('tailscale') || lowerName.includes('ts0')) {
              return addr.address;
            }
            // 2. CGNAT range 100.64.0.0 - 100.127.255.255
            const parts = addr.address.split('.').map(Number);
            if (parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) {
              return addr.address;
            }
          }
        }
      }
    } catch {}
    return null;
  }

  /**
   * Determine the effective Hub URL for agent metrics push:
   * Prioritizes:
   * 1. System Setting `monitoring_hub_url` (configured in UI Settings)
   * 2. Environment variable `MONITORING_HUB_URL`
   * 3. Environment variable `TAILSCALE_IP`
   * 4. Auto-detected host Tailscale IP (e.g. http://100.x.y.z:3001)
   * 5. Request Host fallback
   */
  static getEffectiveHubUrl(reqHostUrl?: string): string {
    // 1. Check system_settings
    try {
      const row = db.prepare("SELECT value FROM system_settings WHERE key = 'monitoring_hub_url'").get() as { value: string } | undefined;
      if (row && row.value && row.value.trim().length > 0) {
        return row.value.trim().replace(/\/+$/, '');
      }
    } catch {}

    // 2. Check process.env.MONITORING_HUB_URL
    if (process.env.MONITORING_HUB_URL && process.env.MONITORING_HUB_URL.trim().length > 0) {
      return process.env.MONITORING_HUB_URL.trim().replace(/\/+$/, '');
    }

    // 3. Check process.env.TAILSCALE_IP
    if (process.env.TAILSCALE_IP && process.env.TAILSCALE_IP.trim().length > 0) {
      const tsIp = process.env.TAILSCALE_IP.trim();
      const proto = tsIp.startsWith('http://') || tsIp.startsWith('https://') ? '' : 'http://';
      const portSuffix = tsIp.includes(':') ? '' : `:${config.port}`;
      return `${proto}${tsIp}${portSuffix}`.replace(/\/+$/, '');
    }

    // 4. Auto-detect host Tailscale IP
    const detectedTsIp = this.detectTailscaleIp();
    if (detectedTsIp) {
      return `http://${detectedTsIp}:${config.port}`;
    }

    // 5. Fallback to request host
    if (reqHostUrl && reqHostUrl.trim().length > 0) {
      return reqHostUrl.trim().replace(/\/+$/, '');
    }

    return `http://127.0.0.1:${config.port}`;
  }

  /**
   * Helper: Hash bearer token with SHA-256 for fast constant-time lookup
   */
  private static hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  /**
   * Helper: Generate a secure agent bearer token
   */
  private static generateToken(): { rawToken: string; tokenHash: string; tokenPreview: string; tokenEncrypted: string } {
    const rawToken = `sh_mon_${crypto.randomBytes(24).toString('hex')}`;
    const tokenHash = this.hashToken(rawToken);
    const tokenPreview = `${rawToken.substring(0, 10)}...${rawToken.substring(rawToken.length - 4)}`;
    const tokenEncrypted = JSON.stringify(CryptoService.encrypt(rawToken));

    return { rawToken, tokenHash, tokenPreview, tokenEncrypted };
  }

  /**
   * Enable monitoring on a device, generating an agent registration & install commands
   */
  static enableMonitoring(deviceId: string, userId: string, hostUrl?: string): {
    agent: MonitoringAgentRecord;
    rawToken: string;
    installLinux: string;
    installWindows: string;
  } {
    // Verify device permission
    const device = DeviceService.getDeviceForUser(deviceId, userId);
    if (!device) {
      throw new Error('Device not found or access denied');
    }

    const { rawToken, tokenHash, tokenPreview, tokenEncrypted } = this.generateToken();
    const existing = db.prepare('SELECT * FROM monitoring_agents WHERE device_id = ?').get(deviceId) as MonitoringAgentRecord | undefined;

    const now = new Date().toISOString();
    let agentId: string;

    if (existing) {
      agentId = existing.id;
      db.prepare(`
        UPDATE monitoring_agents
        SET token_hash = ?, token_preview = ?, token_encrypted = ?, status = 'pending', updated_at = ?
        WHERE id = ?
      `).run(tokenHash, tokenPreview, tokenEncrypted, now, agentId);
    } else {
      agentId = uuidv4();
      db.prepare(`
        INSERT INTO monitoring_agents (id, device_id, token_hash, token_preview, token_encrypted, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(agentId, deviceId, tokenHash, tokenPreview, tokenEncrypted, now, now);
    }

    const agent = (db.prepare('SELECT * FROM monitoring_agents WHERE id = ?').get(agentId) as unknown) as MonitoringAgentRecord;
    const baseHub = this.getEffectiveHubUrl(hostUrl);

    return {
      agent,
      rawToken,
      installLinux: `curl -sSL "${baseHub}/api/monitoring/install.sh?token=${rawToken}" | sudo bash`,
      installWindows: `irm "${baseHub}/api/monitoring/install.ps1?token=${rawToken}" | iex`,
    };
  }

  /**
   * Regenerate bearer token for a monitored device
   */
  static regenerateToken(deviceId: string, userId: string, hostUrl?: string) {
    return this.enableMonitoring(deviceId, userId, hostUrl);
  }

  /**
   * Disable monitoring and wipe historical metrics for a device
   */
  static disableMonitoring(deviceId: string, userId: string): boolean {
    const device = DeviceService.getDeviceForUser(deviceId, userId);
    if (!device) {
      throw new Error('Device not found or access denied');
    }

    db.prepare('DELETE FROM monitoring_agents WHERE device_id = ?').run(deviceId);
    db.prepare('DELETE FROM monitoring_metrics_raw WHERE device_id = ?').run(deviceId);
    db.prepare('DELETE FROM monitoring_metrics_rollup_5m WHERE device_id = ?').run(deviceId);
    db.prepare('DELETE FROM monitoring_metrics_rollup_1h WHERE device_id = ?').run(deviceId);

    return true;
  }

  /**
   * Retrieve monitoring agent record for a specific device (decrypts token for owner)
   */
  static getAgentStatus(deviceId: string, userId: string, hostUrl?: string) {
    const device = DeviceService.getDeviceForUser(deviceId, userId);
    if (!device) {
      return null;
    }

    const agent = (db.prepare('SELECT * FROM monitoring_agents WHERE device_id = ?').get(deviceId) as unknown) as MonitoringAgentRecord | undefined;
    if (!agent) {
      return null;
    }

    let rawToken = '';
    try {
      rawToken = CryptoService.decrypt<string>(JSON.parse(agent.token_encrypted));
    } catch {}

    const baseHub = this.getEffectiveHubUrl(hostUrl);

    return {
      agent: {
        ...agent,
        system_info: agent.system_info ? JSON.parse(agent.system_info) : null,
      },
      rawToken,
      installLinux: `curl -sSL "${baseHub}/api/monitoring/install.sh?token=${rawToken}" | sudo bash`,
      installWindows: `irm "${baseHub}/api/monitoring/install.ps1?token=${rawToken}" | iex`,
    };
  }

  /**
   * Authenticate incoming agent report via Bearer token
   */
  static authenticateAgentToken(rawToken: string): { deviceId: string; agentId: string } | null {
    if (!rawToken || !rawToken.startsWith('sh_mon_')) return null;

    const tokenHash = this.hashToken(rawToken);
    const agent = db.prepare('SELECT id, device_id FROM monitoring_agents WHERE token_hash = ?').get(tokenHash) as { id: string; device_id: string } | undefined;

    if (!agent) return null;
    return { deviceId: agent.device_id, agentId: agent.id };
  }

  /**
   * Record an incoming metrics payload from an agent
   */
  static recordMetrics(deviceId: string, payload: IngestMetricPayload) {
    const timestamp = payload.timestamp || Math.floor(Date.now() / 1000);
    const nowIso = new Date().toISOString();

    // 1. Insert into raw metrics table
    db.prepare(`
      INSERT INTO monitoring_metrics_raw (
        device_id, timestamp, cpu_usage, cpu_per_core, ram_used, ram_total, ram_percent,
        swap_used, swap_total, swap_percent, disk_read_bytes_sec, disk_write_bytes_sec,
        net_rx_bytes_sec, net_tx_bytes_sec, cpu_temp, load_1, load_5, load_15, uptime, disks
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      deviceId,
      timestamp,
      payload.cpu_usage || 0,
      payload.cpu_per_core ? JSON.stringify(payload.cpu_per_core) : null,
      payload.ram_used || 0,
      payload.ram_total || 0,
      payload.ram_percent || 0,
      payload.swap_used || 0,
      payload.swap_total || 0,
      payload.swap_percent || 0,
      payload.disk_read_bytes_sec || 0,
      payload.disk_write_bytes_sec || 0,
      payload.net_rx_bytes_sec || 0,
      payload.net_tx_bytes_sec || 0,
      payload.cpu_temp !== undefined ? payload.cpu_temp : null,
      payload.load_1 !== undefined ? payload.load_1 : null,
      payload.load_5 !== undefined ? payload.load_5 : null,
      payload.load_15 !== undefined ? payload.load_15 : null,
      payload.uptime || 0,
      payload.disks ? JSON.stringify(payload.disks) : null
    );

    // 2. Update agent status to online and record system info
    if (payload.system_info) {
      db.prepare(`
        UPDATE monitoring_agents
        SET status = 'online', last_seen_at = ?, system_info = ?, updated_at = ?
        WHERE device_id = ?
      `).run(nowIso, JSON.stringify(payload.system_info), nowIso, deviceId);
    } else {
      db.prepare(`
        UPDATE monitoring_agents
        SET status = 'online', last_seen_at = ?, updated_at = ?
        WHERE device_id = ?
      `).run(nowIso, nowIso, deviceId);
    }
  }

  /**
   * Get all monitored devices visible to a user with their latest resource snapshot
   */
  static getUserMonitoredDevices(userId: string): MonitoredDeviceSummary[] {
    const userDevices = DeviceService.getUserDevices(userId);
    if (userDevices.length === 0) return [];

    const summaries: MonitoredDeviceSummary[] = [];

    for (const dev of userDevices) {
      const agent = db.prepare(`
        SELECT id, status, last_seen_at, system_info
        FROM monitoring_agents
        WHERE device_id = ?
      `).get(dev.id) as { id: string; status: 'pending' | 'online' | 'offline'; last_seen_at: string | null; system_info: string | null } | undefined;

      if (!agent) continue; // Only include devices with monitoring enabled

      // Determine live online/offline state
      let effectiveStatus = agent.status;
      if (agent.status === 'online' && agent.last_seen_at) {
        const lastSeenMs = new Date(agent.last_seen_at).getTime();
        if (Date.now() - lastSeenMs > 45000) {
          effectiveStatus = 'offline';
        }
      }

      // Get latest raw metric snapshot
      const latestMetric = db.prepare(`
        SELECT cpu_usage, ram_percent, ram_used, ram_total, net_rx_bytes_sec, net_tx_bytes_sec, cpu_temp, uptime, disks
        FROM monitoring_metrics_raw
        WHERE device_id = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `).get(dev.id) as any | undefined;

      let currentMetrics: MonitoredDeviceSummary['current_metrics'] = null;
      if (latestMetric) {
        let diskPct = 0;
        if (latestMetric.disks) {
          try {
            const parsedDisks = JSON.parse(latestMetric.disks);
            if (parsedDisks.length > 0) {
              diskPct = parsedDisks[0].used_pct || 0;
            }
          } catch {}
        }

        currentMetrics = {
          cpu_usage: latestMetric.cpu_usage || 0,
          ram_percent: latestMetric.ram_percent || 0,
          ram_used: latestMetric.ram_used || 0,
          ram_total: latestMetric.ram_total || 0,
          disk_percent: diskPct,
          net_rx_bytes_sec: latestMetric.net_rx_bytes_sec || 0,
          net_tx_bytes_sec: latestMetric.net_tx_bytes_sec || 0,
          cpu_temp: latestMetric.cpu_temp,
          uptime: latestMetric.uptime || 0,
        };
      }

      summaries.push({
        id: agent.id,
        device_id: dev.id,
        device_name: dev.name,
        protocol: dev.protocol,
        host: dev.host,
        is_shared: !!dev.is_shared,
        shared_by_user: dev.shared_by_user,
        status: effectiveStatus,
        last_seen_at: agent.last_seen_at,
        system_info: agent.system_info ? JSON.parse(agent.system_info) : null,
        current_metrics: currentMetrics,
      });
    }

    return summaries;
  }

  /**
   * Retrieve time-series metrics formatted for charts across selectable ranges
   */
  static getDeviceMetrics(
    deviceId: string,
    userId: string,
    range: '1h' | '6h' | '24h' | '7d' | '30d' | '120d' = '1h'
  ) {
    const device = DeviceService.getDeviceForUser(deviceId, userId);
    if (!device) {
      throw new Error('Device not found or access denied');
    }

    const nowSec = Math.floor(Date.now() / 1000);
    let startSec = nowSec - 3600;

    switch (range) {
      case '1h':
        startSec = nowSec - 3600;
        break;
      case '6h':
        startSec = nowSec - 6 * 3600;
        break;
      case '24h':
        startSec = nowSec - 24 * 3600;
        break;
      case '7d':
        startSec = nowSec - 7 * 86400;
        break;
      case '30d':
        startSec = nowSec - 30 * 86400;
        break;
      case '120d':
        startSec = nowSec - 120 * 86400;
        break;
    }

    // Determine query table based on range
    if (range === '1h' || range === '6h' || range === '24h') {
      // Query raw metrics
      const rows = db.prepare(`
        SELECT 
          timestamp, cpu_usage, cpu_per_core, ram_used, ram_total, ram_percent,
          swap_used, swap_total, swap_percent, disk_read_bytes_sec, disk_write_bytes_sec,
          net_rx_bytes_sec, net_tx_bytes_sec, cpu_temp, load_1, load_5, load_15, uptime, disks
        FROM monitoring_metrics_raw
        WHERE device_id = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `).all(deviceId, startSec) as any[];

      return {
        range,
        resolution: 'raw',
        points: rows.map(r => ({
          ...r,
          cpu_per_core: r.cpu_per_core ? JSON.parse(r.cpu_per_core) : null,
          disks: r.disks ? JSON.parse(r.disks) : null,
        })),
      };
    } else if (range === '7d') {
      // Query 5m rollup table
      const rows = db.prepare(`
        SELECT 
          timestamp, cpu_usage_avg as cpu_usage, cpu_usage_max, ram_percent_avg as ram_percent,
          disk_read_bytes_sec_avg as disk_read_bytes_sec, disk_write_bytes_sec_avg as disk_write_bytes_sec,
          net_rx_bytes_sec_avg as net_rx_bytes_sec, net_tx_bytes_sec_avg as net_tx_bytes_sec,
          cpu_temp_avg as cpu_temp, load_1_avg as load_1
        FROM monitoring_metrics_rollup_5m
        WHERE device_id = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `).all(deviceId, startSec) as any[];

      return {
        range,
        resolution: '5m',
        points: rows,
      };
    } else {
      // Query 1h rollup table (30d and 120d)
      const rows = db.prepare(`
        SELECT 
          timestamp, cpu_usage_avg as cpu_usage, cpu_usage_max, ram_percent_avg as ram_percent,
          disk_read_bytes_sec_avg as disk_read_bytes_sec, disk_write_bytes_sec_avg as disk_write_bytes_sec,
          net_rx_bytes_sec_avg as net_rx_bytes_sec, net_tx_bytes_sec_avg as net_tx_bytes_sec,
          cpu_temp_avg as cpu_temp, load_1_avg as load_1
        FROM monitoring_metrics_rollup_1h
        WHERE device_id = ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `).all(deviceId, startSec) as any[];

      return {
        range,
        resolution: '1h',
        points: rows,
      };
    }
  }

  /**
   * Background task: Rollup raw metrics & prune data older than 120 days
   */
  static runRollupAndRetention() {
    const nowSec = Math.floor(Date.now() / 1000);
    const oneDayAgo = nowSec - 86400;
    const sevenDaysAgo = nowSec - 7 * 86400;
    const oneHundredTwentyDaysAgo = nowSec - 120 * 86400;

    try {
      // 1. Rollup raw data older than 24 hours into 5-minute buckets (300 sec)
      db.exec(`
        INSERT OR REPLACE INTO monitoring_metrics_rollup_5m (
          device_id, timestamp, cpu_usage_avg, cpu_usage_max, ram_percent_avg,
          disk_read_bytes_sec_avg, disk_write_bytes_sec_avg, net_rx_bytes_sec_avg,
          net_tx_bytes_sec_avg, cpu_temp_avg, load_1_avg
        )
        SELECT 
          device_id,
          (timestamp / 300) * 300 as bucket_time,
          AVG(cpu_usage),
          MAX(cpu_usage),
          AVG(ram_percent),
          AVG(disk_read_bytes_sec),
          AVG(disk_write_bytes_sec),
          AVG(net_rx_bytes_sec),
          AVG(net_tx_bytes_sec),
          AVG(cpu_temp),
          AVG(load_1)
        FROM monitoring_metrics_raw
        WHERE timestamp < ${oneDayAgo}
        GROUP BY device_id, bucket_time;
      `);

      // Delete raw data older than 24h that has been rolled up
      db.exec(`DELETE FROM monitoring_metrics_raw WHERE timestamp < ${oneDayAgo};`);

      // 2. Rollup 5-minute data older than 7 days into 1-hour buckets (3600 sec)
      db.exec(`
        INSERT OR REPLACE INTO monitoring_metrics_rollup_1h (
          device_id, timestamp, cpu_usage_avg, cpu_usage_max, ram_percent_avg,
          disk_read_bytes_sec_avg, disk_write_bytes_sec_avg, net_rx_bytes_sec_avg,
          net_tx_bytes_sec_avg, cpu_temp_avg, load_1_avg
        )
        SELECT 
          device_id,
          (timestamp / 3600) * 3600 as bucket_time,
          AVG(cpu_usage_avg),
          MAX(cpu_usage_max),
          AVG(ram_percent_avg),
          AVG(disk_read_bytes_sec_avg),
          AVG(disk_write_bytes_sec_avg),
          AVG(net_rx_bytes_sec_avg),
          AVG(net_tx_bytes_sec_avg),
          AVG(cpu_temp_avg),
          AVG(load_1_avg)
        FROM monitoring_metrics_rollup_5m
        WHERE timestamp < ${sevenDaysAgo}
        GROUP BY device_id, bucket_time;
      `);

      // Delete 5m data older than 7 days
      db.exec(`DELETE FROM monitoring_metrics_rollup_5m WHERE timestamp < ${sevenDaysAgo};`);

      // 3. 120-Day Retention Pruning: Delete 1h rollups older than 120 days
      db.exec(`DELETE FROM monitoring_metrics_rollup_1h WHERE timestamp < ${oneHundredTwentyDaysAgo};`);

      // 4. Update offline status for agents not seen in last 45 seconds
      const cutoffIso = new Date(Date.now() - 45000).toISOString();
      db.prepare(`
        UPDATE monitoring_agents 
        SET status = 'offline' 
        WHERE status = 'online' AND (last_seen_at IS NULL OR last_seen_at < ?)
      `).run(cutoffIso);

    } catch (err: any) {
      console.error('[MonitoringService] Rollup/Retention job error:', err.message);
    }
  }

  /**
   * Generate Linux Bash installation script on the fly
   */
  static generateLinuxInstallScript(hostUrl: string, token: string): string {
    return `#!/usr/bin/env bash
set -e

HUB_URL="${hostUrl}"
TOKEN="${token}"

echo "=================================================="
echo " Shoreline Connect — Installing Monitoring Agent"
echo "=================================================="

# Detect Architecture
ARCH="$(uname -m)"
case "\$ARCH" in
  x86_64|amd64)
    BIN_ARCH="amd64"
    ;;
  aarch64|arm64)
    BIN_ARCH="arm64"
    ;;
  armv7l|armv6l)
    BIN_ARCH="arm64"
    ;;
  *)
    echo "❌ Unsupported architecture: \$ARCH"
    exit 1
    ;;
esac

echo "-> Detected architecture: \$BIN_ARCH"

TARGET_BIN="/usr/local/bin/shoreline-agent"
DOWNLOAD_URL="\${HUB_URL}/api/monitoring/agent/download/linux/\${BIN_ARCH}"

echo "-> Downloading Shoreline agent binary from \${DOWNLOAD_URL}..."
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "\$DOWNLOAD_URL" -o "\$TARGET_BIN"
elif command -v wget >/dev/null 2>&1; then
  wget -qO "\$TARGET_BIN" "\$DOWNLOAD_URL"
else
  echo "❌ Error: Neither curl nor wget is available."
  exit 1
fi

chmod +x "\$TARGET_BIN"
echo "-> Installed binary to \$TARGET_BIN"

echo "-> Registering and starting systemd service..."
"\$TARGET_BIN" -install -hub "\$HUB_URL" -token "\$TOKEN"

echo ""
echo "=================================================="
echo "✅ Shoreline Monitoring Agent successfully started!"
echo "=================================================="
`;
  }

  /**
   * Generate Windows PowerShell installation script on the fly
   */
  static generateWindowsInstallScript(hostUrl: string, token: string): string {
    return `$ErrorActionPreference = "Stop"

$HubUrl = "${hostUrl}"
$Token = "${token}"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host " Shoreline Connect — Installing Monitoring Agent" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

$InstallDir = "C:\\Program Files\\ShorelineAgent"
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

$ExePath = Join-Path $InstallDir "shoreline-agent.exe"
$DownloadUrl = "$HubUrl/api/monitoring/agent/download/windows/amd64"

Write-Host "-> Downloading Shoreline agent binary from $DownloadUrl..." -ForegroundColor Yellow
Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExePath -UseBasicParsing

Write-Host "-> Registering and starting Windows service..." -ForegroundColor Yellow
& "$ExePath" -install -hub "$HubUrl" -token "$Token"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "✅ Shoreline Monitoring Agent successfully started!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
`;
  }
}
