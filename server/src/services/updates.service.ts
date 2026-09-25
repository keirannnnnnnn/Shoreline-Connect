import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '../db/database.js';
import { config } from '../config/env.js';
import { DeviceService } from './device.service.js';
import { NotificationService } from './notification.service.js';

export interface SoftwareInventoryItem {
  softwareKey: string;
  name: string;
  version?: string;
  publisher?: string;
  installDate?: string;
  arch?: string;
  source: string;
  uninstallString?: string;
  quietUninstallString?: string;
  msiProductCode?: string;
  isPerUser?: boolean;
  isRemotelyUninstallable?: boolean;
}

export interface AvailableUpdateItem {
  name: string;
  currentVersion?: string;
  availableVersion: string;
  packageIdentifier?: string;
  source: string;
  isSecurity?: boolean;
  requiresReboot?: boolean;
}

export interface PackageRecord {
  id: string;
  display_name: string;
  description?: string | null;
  package_source_type: 'file' | 'winget' | 'apt';
  winget_id?: string | null;
  apt_package_name?: string | null;
  created_by_user_id?: string | null;
  created_by_username: string;
  created_at: string;
  updated_at: string;
  total_size_bytes?: number;
  installed_device_count?: number;
  latest_version?: string;
  versions?: PackageVersionRecord[];
}

export interface PackageVersionRecord {
  id: string;
  package_id: string;
  version: string;
  target_os: 'windows' | 'linux' | 'all';
  target_arch: 'amd64' | 'arm64' | 'all';
  file_path?: string | null;
  file_sha256?: string | null;
  file_size_bytes: number;
  silent_install_args?: string | null;
  uninstall_command?: string | null;
  expected_exit_codes: string;
  detection_name?: string | null;
  detection_version?: string | null;
  notes?: string | null;
  created_by_user_id?: string | null;
  created_by_username: string;
  created_at: string;
  installed_device_count?: number;
}

export interface AppPinRecord {
  id: string;
  device_id?: string | null;
  device_name?: string | null;
  app_name: string;
  pin_type: 'ignore' | 'pin_version';
  pinned_version?: string | null;
  reason?: string | null;
  created_by_user_id?: string | null;
  created_by_username: string;
  created_at: string;
}

export interface JobRecord {
  id: string;
  device_id: string;
  device_name?: string;
  job_type: string;
  status: string;
  payload_json: string;
  exit_code?: number | null;
  stdout?: string | null;
  stderr?: string | null;
  reboot_required?: number;
  detection_matched?: number | null;
  timeout_seconds: number;
  expires_at?: string | null;
  created_by_user_id?: string | null;
  created_by_username: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export interface ScriptRecord {
  id: string;
  name: string;
  description?: string | null;
  target_os: 'windows' | 'linux' | 'all';
  script_type: 'powershell' | 'batch' | 'bash';
  timeout_seconds: number;
  parameters_schema_json?: string | null;
  is_archived?: number;
  created_by_user_id?: string | null;
  created_by_username: string;
  created_at: string;
  updated_at: string;
  latest_version?: number;
  script_content?: string;
}

export interface AgentBuildRecord {
  id: string;
  version: string;
  target_os: 'windows' | 'linux';
  target_arch: 'amd64' | 'arm64';
  file_path: string;
  file_sha256: string;
  file_size_bytes: number;
  is_install_default: number;
  notes?: string | null;
  created_by_user_id?: string | null;
  created_by_username: string;
  created_at: string;
}

export class UpdatesService {
  private static MAX_LOG_BYTES = 65536; // 64KB log limit

  /**
   * Get agent binaries storage directory
   */
  static getAgentBinariesDir(): string {
    const dir = path.join(config.dataDir, 'agent-binaries');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * Truncate string to maximum length safely
   */
  private static truncateLog(str?: string | null): string | null {
    if (!str) return null;
    if (str.length <= this.MAX_LOG_BYTES) return str;
    return str.substring(0, this.MAX_LOG_BYTES) + '\n... [Log truncated at 64KB limit]';
  }

  /**
   * Synchronize full software inventory scan for a device with diffing
   */
  static syncInventory(deviceId: string, items: SoftwareInventoryItem[]): { added: number; removed: number; modified: number; unchanged: number } {
    const existingRows = db.prepare('SELECT id, software_key, name, version FROM software_inventory WHERE device_id = ?').all(deviceId) as Array<{
      id: string;
      software_key: string;
      name: string;
      version: string | null;
    }>;

    const existingMap = new Map<string, { id: string; name: string; version: string | null }>();
    for (const row of existingRows) {
      existingMap.set(row.software_key, row);
    }

    const incomingKeys = new Set<string>();
    let added = 0;
    let removed = 0;
    let modified = 0;
    let unchanged = 0;

    const insertInv = db.prepare(`
      INSERT INTO software_inventory (
        id, device_id, software_key, name, version, publisher, install_date, arch,
        source, uninstall_string, quiet_uninstall_string, msi_product_code,
        is_per_user, is_remotely_uninstallable, last_seen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    const updateInv = db.prepare(`
      UPDATE software_inventory SET
        name = ?, version = ?, publisher = ?, install_date = ?, arch = ?,
        source = ?, uninstall_string = ?, quiet_uninstall_string = ?, msi_product_code = ?,
        is_per_user = ?, is_remotely_uninstallable = ?, last_seen_at = CURRENT_TIMESTAMP
      WHERE device_id = ? AND software_key = ?
    `);

    const insertHist = db.prepare(`
      INSERT INTO software_inventory_history (
        id, device_id, software_key, change_type, name, old_version, new_version, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    for (const item of items) {
      if (!item.softwareKey || !item.name) continue;
      incomingKeys.add(item.softwareKey);

      const existing = existingMap.get(item.softwareKey);
      const isPerUserInt = item.isPerUser ? 1 : 0;
      const isRemotelyUninstallableInt = item.isRemotelyUninstallable !== false ? 1 : 0;

      if (!existing) {
        // Newly installed software
        const invId = crypto.randomUUID();
        insertInv.run(
          invId,
          deviceId,
          item.softwareKey,
          item.name,
          item.version || null,
          item.publisher || null,
          item.installDate || null,
          item.arch || null,
          item.source,
          item.uninstallString || null,
          item.quietUninstallString || null,
          item.msiProductCode || null,
          isPerUserInt,
          isRemotelyUninstallableInt
        );

        insertHist.run(crypto.randomUUID(), deviceId, item.softwareKey, 'added', item.name, null, item.version || null);
        added++;
      } else {
        const oldVer = existing.version || '';
        const newVer = item.version || '';

        if (oldVer !== newVer) {
          // Version modified
          updateInv.run(
            item.name,
            item.version || null,
            item.publisher || null,
            item.installDate || null,
            item.arch || null,
            item.source,
            item.uninstallString || null,
            item.quietUninstallString || null,
            item.msiProductCode || null,
            isPerUserInt,
            isRemotelyUninstallableInt,
            deviceId,
            item.softwareKey
          );

          insertHist.run(crypto.randomUUID(), deviceId, item.softwareKey, 'modified', item.name, existing.version, item.version || null);
          modified++;
        } else {
          // Unchanged, touch last_seen_at
          db.prepare('UPDATE software_inventory SET last_seen_at = CURRENT_TIMESTAMP WHERE device_id = ? AND software_key = ?').run(deviceId, item.softwareKey);
          unchanged++;
        }
      }
    }

    // Identify uninstalled / removed items
    const deleteInv = db.prepare('DELETE FROM software_inventory WHERE id = ?');
    for (const [key, existing] of existingMap.entries()) {
      if (!incomingKeys.has(key)) {
        deleteInv.run(existing.id);
        insertHist.run(crypto.randomUUID(), deviceId, key, 'removed', existing.name, existing.version, null);
        removed++;
      }
    }

    return { added, removed, modified, unchanged };
  }

  /**
   * Replace available updates for a device on check_updates run
   */
  static replaceAvailableUpdates(deviceId: string, updates: AvailableUpdateItem[]): void {
    db.prepare('DELETE FROM device_available_updates WHERE device_id = ?').run(deviceId);

    const insertStmt = db.prepare(`
      INSERT INTO device_available_updates (
        id, device_id, name, current_version, available_version, package_identifier, source,
        is_security, requires_reboot, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    for (const u of updates) {
      if (!u.name || !u.availableVersion) continue;
      insertStmt.run(
        crypto.randomUUID(),
        deviceId,
        u.name,
        u.currentVersion || null,
        u.availableVersion,
        u.packageIdentifier || null,
        u.source || 'winget',
        u.isSecurity ? 1 : 0,
        u.requiresReboot ? 1 : 0
      );
    }

    if (updates.length > 0) {
      const dev = db.prepare('SELECT name FROM devices WHERE id = ?').get(deviceId) as { name: string } | undefined;
      NotificationService.notify({
        type: 'updates_available',
        deviceId,
        deviceName: dev?.name || deviceId,
        details: { updateCount: updates.length, updates },
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Check if device is currently online (last seen within 45s)
   */
  static isDeviceOnline(deviceId: string): boolean {
    const agent = db.prepare('SELECT status, last_seen_at FROM monitoring_agents WHERE device_id = ?').get(deviceId) as {
      status: string;
      last_seen_at: string | null;
    } | undefined;

    if (!agent || agent.status !== 'online' || !agent.last_seen_at) return false;
    const diffMs = Date.now() - new Date(agent.last_seen_at).getTime();
    return diffMs <= 45000;
  }

  /**
   * Fetch the next pending job for an agent on its 15s check-in cycle
   * Concurrency limit applies only to heavy jobs: install, uninstall, upgrade, run_script, agent_update.
   * Light jobs (inventory_scan, check_updates) are NEVER throttled.
   */
  static getNextPendingJob(deviceId: string): JobRecord | null {
    // Ensure only one job runs at a time per device
    const active = db.prepare(`
      SELECT id FROM update_jobs
      WHERE device_id = ? AND status IN ('sent', 'downloading', 'running')
    `).get(deviceId);

    if (active) {
      return null;
    }

    const candidateJobs = db.prepare(`
      SELECT * FROM update_jobs
      WHERE device_id = ? AND status IN ('queued', 'waiting_for_device')
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      ORDER BY created_at ASC
    `).all(deviceId) as unknown as JobRecord[];

    if (!candidateJobs || candidateJobs.length === 0) {
      return null;
    }

    let concurrencyLimit = 5;
    try {
      const concRow = db.prepare("SELECT value FROM system_settings WHERE key = 'updates_fleet_concurrency'").get() as { value: string } | undefined;
      if (concRow?.value) {
        const parsed = parseInt(concRow.value, 10);
        if (!isNaN(parsed) && parsed > 0) concurrencyLimit = parsed;
      }
    } catch {}

    const heavyJobTypes = ['install', 'uninstall', 'upgrade', 'run_script', 'agent_update'];

    // Check fleet-wide running heavy jobs
    const runningHeavyCountRow = db.prepare(`
      SELECT COUNT(*) as count FROM update_jobs
      WHERE status IN ('sent', 'downloading', 'running')
        AND job_type IN ('install', 'uninstall', 'upgrade', 'run_script', 'agent_update')
    `).get() as { count: number };
    const runningHeavyCount = runningHeavyCountRow?.count || 0;

    let nextJob: JobRecord | null = null;
    for (const job of candidateJobs) {
      if (!heavyJobTypes.includes(job.job_type)) {
        // Light job (inventory_scan, check_updates) — proceed immediately
        nextJob = job;
        break;
      } else {
        // Heavy job — check concurrency limit
        if (runningHeavyCount < concurrencyLimit) {
          nextJob = job;
          break;
        }
      }
    }

    if (!nextJob) {
      return null;
    }

    // Mark as sent and record started_at
    db.prepare(`
      UPDATE update_jobs
      SET status = 'sent', started_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(nextJob.id);

    nextJob.status = 'sent';
    return nextJob;
  }

  /**
   * Process job execution progress / outcome report from agent
   */
  static reportJobStatus(
    jobId: string,
    deviceId: string,
    status: string,
    exitCode?: number | null,
    stdout?: string | null,
    stderr?: string | null,
    rebootRequired?: boolean,
    detectionMatched?: boolean | null
  ): void {
    const validStatuses = ['sent', 'downloading', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled', 'succeeded_not_detected'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid job status: ${status}`);
    }

    let finalStatus = status;
    if (status === 'succeeded' && detectionMatched === false) {
      finalStatus = 'succeeded_not_detected';
    }

    const isTerminal = ['succeeded', 'failed', 'timed_out', 'cancelled', 'succeeded_not_detected'].includes(finalStatus);
    const truncOut = this.truncateLog(stdout);
    const truncErr = this.truncateLog(stderr);
    const rebootInt = rebootRequired ? 1 : 0;
    const matchInt = detectionMatched !== undefined && detectionMatched !== null ? (detectionMatched ? 1 : 0) : null;

    if (isTerminal) {
      db.prepare(`
        UPDATE update_jobs
        SET status = ?, exit_code = ?, stdout = ?, stderr = ?, reboot_required = ?, detection_matched = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND device_id = ?
      `).run(finalStatus, exitCode !== undefined ? exitCode : null, truncOut, truncErr, rebootInt, matchInt, jobId, deviceId);

      if (['failed', 'timed_out', 'succeeded_not_detected'].includes(finalStatus)) {
        const jobRow = db.prepare('SELECT id, job_type, device_id FROM update_jobs WHERE id = ?').get(jobId) as any;
        const devRow = jobRow ? db.prepare('SELECT name FROM devices WHERE id = ?').get(jobRow.device_id) as any : null;
        NotificationService.notify({
          type: finalStatus === 'succeeded_not_detected' ? 'succeeded_not_detected' : (finalStatus === 'timed_out' ? 'job_timed_out' : 'job_failed'),
          deviceId,
          deviceName: devRow?.name || deviceId,
          jobId,
          jobType: jobRow?.job_type,
          details: { exitCode, stderr: truncErr, stdout: truncOut },
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      db.prepare(`
        UPDATE update_jobs
        SET status = ?, stdout = COALESCE(?, stdout), stderr = COALESCE(?, stderr), reboot_required = ?
        WHERE id = ? AND device_id = ?
      `).run(finalStatus, truncOut, truncErr, rebootInt, jobId, deviceId);
    }
  }

  /**
   * Queue a new update job with offline 'waiting_for_device' state and optional expiry
   */
  static queueJob(
    deviceId: string,
    jobType: string,
    payload: any,
    userId: string,
    username: string,
    timeoutSeconds: number = 1800,
    expiresAt?: string | null
  ): string {
    const validTypes = ['inventory_scan', 'check_updates', 'install', 'uninstall', 'upgrade', 'agent_update', 'run_script'];
    if (!validTypes.includes(jobType)) {
      throw new Error(`Invalid job type: ${jobType}`);
    }

    const deviceData = DeviceService.getDeviceForUser(deviceId, userId);
    if (!deviceData) {
      throw new Error('Device not found or access denied');
    }

    const jobId = crypto.randomUUID();
    const isOnline = this.isDeviceOnline(deviceId);
    const initialStatus = isOnline ? 'queued' : 'waiting_for_device';

    db.prepare(`
      INSERT INTO update_jobs (
        id, device_id, job_type, status, payload_json, timeout_seconds, expires_at,
        created_by_user_id, created_by_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(jobId, deviceId, jobType, initialStatus, JSON.stringify(payload || {}), timeoutSeconds, expiresAt || null, userId, username);

    // Audit log
    this.logAudit(userId, username, `queue_job_${jobType}`, deviceId, deviceData.device.name, undefined, {
      jobId,
      jobType,
      initialStatus,
      payload,
    });

    return jobId;
  }

  /**
   * Rescan all online/available devices for software inventory
   */
  static rescanAllDevices(userId: string, username: string): { queuedCount: number } {
    const accessibleDevices = DeviceService.getUserDevices(userId);
    let queuedCount = 0;

    for (const d of accessibleDevices) {
      // Check if monitoring is enabled on device
      const agent = db.prepare('SELECT id FROM monitoring_agents WHERE device_id = ?').get(d.id);
      if (agent) {
        this.queueJob(d.id, 'inventory_scan', {}, userId, username, 600);
        queuedCount++;
      }
    }

    this.logAudit(userId, username, 'rescan_all_devices', undefined, undefined, undefined, { queuedCount });
    return { queuedCount };
  }

  /**
   * Cancel a queued or waiting job
   */
  static cancelJob(jobId: string, userId: string, username: string, isAdmin: boolean): void {
    const job = db.prepare('SELECT * FROM update_jobs WHERE id = ?').get(jobId) as JobRecord | undefined;
    if (!job) {
      throw new Error('Job not found');
    }

    const deviceData = DeviceService.getDeviceForUser(job.device_id, userId);
    if (!deviceData) {
      throw new Error('Access denied to device');
    }

    if (!isAdmin && job.created_by_user_id !== userId) {
      throw new Error('Only the creator or an administrator can cancel this job');
    }

    if (job.status !== 'queued' && job.status !== 'waiting_for_device') {
      throw new Error(`Cannot cancel job in '${job.status}' status`);
    }

    db.prepare(`
      UPDATE update_jobs
      SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(jobId);

    this.logAudit(userId, username, 'cancel_job', job.device_id, deviceData.device.name, undefined, { jobId });
  }

  /**
   * Bulk cancel jobs in queued or waiting_for_device status
   */
  static cancelJobsBulk(jobIds: string[], userId: string, username: string, isAdmin: boolean): { cancelledCount: number } {
    let cancelledCount = 0;
    for (const jid of jobIds) {
      try {
        this.cancelJob(jid, userId, username, isAdmin);
        cancelledCount++;
      } catch {}
    }
    return { cancelledCount };
  }

  /**
   * Log action to immutable audit trail
   */
  static logAudit(
    userId: string,
    username: string,
    action: string,
    deviceId?: string,
    deviceName?: string,
    packageId?: string,
    details?: any
  ): void {
    db.prepare(`
      INSERT INTO update_audit_logs (
        id, user_id, username, action, device_id, device_name, package_id, details_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      crypto.randomUUID(),
      userId,
      username,
      action,
      deviceId || null,
      deviceName || null,
      packageId || null,
      details ? JSON.stringify(details) : null
    );
  }

  /**
   * Get Overview summary counts
   */
  static getOverview(userId: string) {
    const accessibleDevices = DeviceService.getUserDevices(userId);
    const deviceIds = accessibleDevices.map((d) => d.id);

    if (deviceIds.length === 0) {
      return {
        devicesWithUpdates: 0,
        failedJobsLast7Days: 0,
        devicesPendingReboot: 0,
        detectionUnavailable: 0,
        agentsOutOfDate: 0,
        totalTrackedSoftware: 0,
        totalMonitoredAgents: 0,
        agentsOnline: 0,
      };
    }

    const placeholders = deviceIds.map(() => '?').join(',');

    // 1. Devices with updates available
    const updatesRow = db.prepare(`
      SELECT COUNT(DISTINCT device_id) as count
      FROM device_available_updates
      WHERE device_id IN (${placeholders})
    `).get(...deviceIds) as { count: number };

    // 2. Failed jobs in last 7 days
    const failedJobsRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM update_jobs
      WHERE device_id IN (${placeholders})
        AND status = 'failed'
        AND created_at >= datetime('now', '-7 days')
    `).get(...deviceIds) as { count: number };

    // 3. Devices pending reboot
    const rebootRow = db.prepare(`
      SELECT COUNT(DISTINCT device_id) as count
      FROM update_jobs
      WHERE device_id IN (${placeholders})
        AND reboot_required = 1
        AND status = 'succeeded'
    `).get(...deviceIds) as { count: number };

    // 4. Total software inventory records
    const softwareCountRow = db.prepare(`
      SELECT COUNT(*) as count
      FROM software_inventory
      WHERE device_id IN (${placeholders})
    `).get(...deviceIds) as { count: number };

    // 5. Package Library counts & size
    const pkgRow = db.prepare('SELECT COUNT(*) as count FROM update_packages').get() as { count: number };
    const pkgSizeRow = db.prepare('SELECT SUM(file_size_bytes) as total_bytes FROM update_package_versions').get() as { total_bytes: number };

    // 6. Detection unavailable count (devices where check_updates failed)
    const detUnavailRow = db.prepare(`
      SELECT COUNT(DISTINCT device_id) as count
      FROM update_jobs
      WHERE device_id IN (${placeholders})
        AND job_type = 'check_updates'
        AND status = 'failed'
        AND created_at >= datetime('now', '-7 days')
    `).get(...deviceIds) as { count: number };

    const latestVersion = this.getLatestServerAgentVersion();
    const agentsData = this.getAgentsList(userId);
    const agentsWithVer = agentsData.agents;
    const agentsOutOfDate = agentsWithVer.filter((a: any) => a.isOutdated).length;
    const agentsOnline = agentsWithVer.filter((a: any) => a.status === 'online').length;

    return {
      devicesWithUpdates: updatesRow.count || 0,
      failedJobsLast7Days: failedJobsRow.count || 0,
      devicesPendingReboot: rebootRow.count || 0,
      detectionUnavailable: detUnavailRow.count || 0,
      agentsOutOfDate,
      totalTrackedSoftware: softwareCountRow.count || 0,
      totalMonitoredAgents: agentsWithVer.length,
      agentsOnline,
      totalPackages: pkgRow.count || 0,
      totalPackageLibraryBytes: pkgSizeRow.total_bytes || 0,
      latestServerVersion: latestVersion,
    };
  }

  /**
   * Resolve the version string of the precompiled binaries built with this server
   */
  static getLatestServerAgentVersion(): string {
    const candidatePaths = [
      path.resolve(this.getAgentBinariesDir(), 'VERSION'),
      path.resolve(__dirname, '../../agents/VERSION'),
      path.resolve(__dirname, '../../../agents/VERSION'),
      path.resolve(__dirname, '../../../agent/VERSION'),
      path.resolve(process.cwd(), 'agent/VERSION'),
      path.resolve(process.cwd(), 'server/agents/VERSION'),
      path.resolve(process.cwd(), '../agent/VERSION'),
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          const ver = fs.readFileSync(p, 'utf8').trim();
          if (ver) return ver;
        } catch {}
      }
    }

    return '1.1.1';
  }

  /**
   * Get fleet software inventory
   */
  static getFleetInventory(userId: string, search?: string) {
    const accessibleDevices = DeviceService.getUserDevices(userId);
    if (accessibleDevices.length === 0) return [];

    const deviceMap = new Map(accessibleDevices.map((d) => [d.id, d.name]));
    const placeholders = accessibleDevices.map(() => '?').join(',');

    let query = `
      SELECT si.*, d.name as device_name
      FROM software_inventory si
      JOIN devices d ON d.id = si.device_id
      WHERE si.device_id IN (${placeholders})
    `;
    const params: any[] = [...accessibleDevices.map((d) => d.id)];

    if (search && search.trim().length > 0) {
      query += ` AND (si.name LIKE ? OR si.publisher LIKE ? OR si.version LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    query += ` ORDER BY si.name ASC, si.version ASC`;
    const rows = db.prepare(query).all(...params) as any[];

    // Group by App name + Publisher
    const grouped = new Map<string, { name: string; publisher: string | null; installs: any[] }>();
    for (const r of rows) {
      const groupKey = `${r.name}___${r.publisher || ''}`;
      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          name: r.name,
          publisher: r.publisher,
          installs: [],
        });
      }
      grouped.get(groupKey)!.installs.push({
        id: r.id,
        deviceId: r.device_id,
        deviceName: r.device_name || deviceMap.get(r.device_id) || 'Unknown',
        version: r.version,
        arch: r.arch,
        source: r.source,
        installDate: r.install_date,
        isPerUser: Boolean(r.is_per_user),
        isRemotelyUninstallable: Boolean(r.is_remotely_uninstallable),
        quietUninstallString: r.quiet_uninstall_string,
        uninstallString: r.uninstall_string,
        msiProductCode: r.msi_product_code,
      });
    }

    return Array.from(grouped.values());
  }

  /**
   * Get software inventory for a specific device
   */
  static getDeviceInventory(deviceId: string, userId: string) {
    const deviceData = DeviceService.getDeviceForUser(deviceId, userId);
    if (!deviceData) {
      throw new Error('Device not found or access denied');
    }

    const items = db.prepare(`
      SELECT * FROM software_inventory
      WHERE device_id = ?
      ORDER BY name ASC
    `).all(deviceId) as any[];

    const history = db.prepare(`
      SELECT * FROM software_inventory_history
      WHERE device_id = ?
      ORDER BY changed_at DESC
      LIMIT 100
    `).all(deviceId) as any[];

    return { items, history, deviceName: deviceData.device.name };
  }

  /**
   * Get full Agents list with platform, version drift, and online state
   */
  static getAgentsList(userId: string): { latestVersion: string; agents: any[] } {
    const accessibleDevices = DeviceService.getUserDevices(userId);
    const latestVersion = this.getLatestServerAgentVersion();
    if (accessibleDevices.length === 0) return { latestVersion, agents: [] };

    const agentsList: any[] = [];
    const now = Date.now();

    for (const d of accessibleDevices) {
      const agent = db.prepare(`
        SELECT id, status, last_seen_at, agent_version, system_info
        FROM monitoring_agents
        WHERE device_id = ?
      `).get(d.id) as any | undefined;

      if (!agent) continue;

      let effectiveStatus = agent.status;
      if (agent.status === 'online' && agent.last_seen_at) {
        const lastSeenMs = new Date(agent.last_seen_at).getTime();
        if (now - lastSeenMs > 45000) {
          effectiveStatus = 'offline';
        }
      }

      let parsedSysInfo = null;
      if (agent.system_info) {
        try {
          parsedSysInfo = JSON.parse(agent.system_info);
        } catch {}
      }

      // Check for active / waiting jobs
      const activeJob = db.prepare(`
        SELECT id, job_type, status, created_at
        FROM update_jobs
        WHERE device_id = ? AND status IN ('queued', 'waiting_for_device', 'sent', 'downloading', 'running')
        ORDER BY created_at DESC
        LIMIT 1
      `).get(d.id);

      const reportedVer = agent.agent_version || '1.0.0';
      const isOutdated = reportedVer !== latestVersion;

      agentsList.push({
        deviceId: d.id,
        deviceName: d.name,
        host: d.host,
        protocol: d.protocol,
        agentId: agent.id,
        agentVersion: reportedVer,
        latestVersion,
        isOutdated,
        status: effectiveStatus,
        lastSeenAt: agent.last_seen_at,
        platform: parsedSysInfo ? `${parsedSysInfo.os || 'unknown'} (${parsedSysInfo.arch || 'unknown'})` : 'unknown',
        os: parsedSysInfo?.os || 'windows',
        arch: parsedSysInfo?.arch || 'amd64',
        cpuModel: parsedSysInfo?.cpu_model || null,
        cpuCores: parsedSysInfo?.cpu_cores || null,
        activeJob,
      });
    }

    return { latestVersion, agents: agentsList };
  }

  /**
   * One-click queue updates for all outdated agents
   */
  static updateAllOutdatedAgents(
    userId: string,
    username: string,
    expiresAt?: string | null
  ): { queuedCount: number; jobIds: string[] } {
    const data = this.getAgentsList(userId);
    const outdatedDevIds = data.agents.filter((a) => a.isOutdated).map((a) => a.deviceId);
    if (outdatedDevIds.length === 0) {
      return { queuedCount: 0, jobIds: [] };
    }
    return this.queueFleetAgentUpdate(outdatedDevIds, null, userId, username, expiresAt);
  }

  /**
   * Get all registered agent builds
   */
  static getAgentBuilds(): AgentBuildRecord[] {
    return (db.prepare('SELECT * FROM update_agent_builds ORDER BY created_at DESC').all() as unknown) as AgentBuildRecord[];
  }

  /**
   * Save uploaded agent binary build
   */
  static saveAgentBuild(
    version: string,
    targetOs: 'windows' | 'linux',
    targetArch: 'amd64' | 'arm64',
    buffer: Buffer,
    notes: string | undefined,
    userId: string,
    username: string
  ): AgentBuildRecord {
    const id = crypto.randomUUID();
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const filename = `shoreline-agent-${version}-${targetOs}-${targetArch}${targetOs === 'windows' ? '.exe' : ''}`;
    const storageDir = this.getAgentBinariesDir();
    const targetPath = path.join(storageDir, filename);

    fs.writeFileSync(targetPath, buffer);

    db.prepare(`
      INSERT INTO update_agent_builds (
        id, version, target_os, target_arch, file_path, file_sha256, file_size_bytes,
        is_install_default, notes, created_by_user_id, created_by_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(id, version, targetOs, targetArch, targetPath, sha256, buffer.length, notes || null, userId, username);

    this.logAudit(userId, username, 'upload_agent_build', undefined, undefined, undefined, {
      buildId: id,
      version,
      targetOs,
      targetArch,
      sha256,
      sizeBytes: buffer.length,
    });

    return (db.prepare('SELECT * FROM update_agent_builds WHERE id = ?').get(id) as unknown) as AgentBuildRecord;
  }

  /**
   * Set an agent build as the install default for its OS and arch
   */
  static setInstallDefaultAgentBuild(buildId: string, userId: string, username: string): void {
    const build = db.prepare('SELECT * FROM update_agent_builds WHERE id = ?').get(buildId) as AgentBuildRecord | undefined;
    if (!build) throw new Error('Agent build not found');

    // Reset default for other builds of same OS and arch
    db.prepare(`
      UPDATE update_agent_builds
      SET is_install_default = 0
      WHERE target_os = ? AND target_arch = ?
    `).run(build.target_os, build.target_arch);

    db.prepare('UPDATE update_agent_builds SET is_install_default = 1 WHERE id = ?').run(buildId);

    this.logAudit(userId, username, 'set_install_default_agent_build', undefined, undefined, undefined, {
      buildId,
      version: build.version,
      targetOs: build.target_os,
      targetArch: build.target_arch,
    });
  }

  /**
   * Delete an agent build
   */
  static deleteAgentBuild(buildId: string, userId: string, username: string): void {
    const build = db.prepare('SELECT * FROM update_agent_builds WHERE id = ?').get(buildId) as AgentBuildRecord | undefined;
    if (!build) throw new Error('Agent build not found');

    if (fs.existsSync(build.file_path)) {
      try { fs.unlinkSync(build.file_path); } catch {}
    }

    db.prepare('DELETE FROM update_agent_builds WHERE id = ?').run(buildId);
    this.logAudit(userId, username, 'delete_agent_build', undefined, undefined, undefined, { buildId, version: build.version });
  }

  /**
   * Queue agent self-update for a device
   */
  static queueAgentUpdate(
    deviceId: string,
    buildId: string | null,
    userId: string,
    username: string,
    expiresAt?: string | null
  ): string {
    const deviceData = DeviceService.getDeviceForUser(deviceId, userId);
    if (!deviceData) throw new Error('Device not found or access denied');

    let payload: any = {};

    if (buildId) {
      const build = db.prepare('SELECT * FROM update_agent_builds WHERE id = ?').get(buildId) as AgentBuildRecord | undefined;
      if (!build) throw new Error('Selected agent build not found');
      payload = {
        build_id: build.id,
        version: build.version,
        sha256: build.file_sha256,
        download_path: `/api/updates/agent/download-build/${build.id}`,
      };
    } else {
      payload = {
        use_default_build: true,
      };
    }

    return this.queueJob(deviceId, 'agent_update', payload, userId, username, 600, expiresAt);
  }

  /**
   * Queue agent self-update for multiple devices
   */
  static queueFleetAgentUpdate(
    deviceIds: string[],
    buildId: string | null,
    userId: string,
    username: string,
    expiresAt?: string | null
  ): { queuedCount: number; jobIds: string[] } {
    const jobIds: string[] = [];
    for (const devId of deviceIds) {
      try {
        const jid = this.queueAgentUpdate(devId, buildId, userId, username, expiresAt);
        jobIds.push(jid);
      } catch (err: any) {
        console.warn(`[AgentUpdateFleet] Skipped device ${devId}:`, err.message);
      }
    }
    return { queuedCount: jobIds.length, jobIds };
  }

  /**
   * ==========================================
   * SCRIPT LIBRARY (PHASE 2)
   * ==========================================
   */

  /**
   * List all scripts with their latest version content
   */
  static getScripts(): ScriptRecord[] {
    const scripts = (db.prepare(`
      SELECT s.*, 
        (SELECT MAX(version_num) FROM update_script_versions WHERE script_id = s.id) as latest_version,
        (SELECT script_content FROM update_script_versions WHERE script_id = s.id ORDER BY version_num DESC LIMIT 1) as script_content
      FROM update_scripts s
      WHERE s.is_archived = 0
      ORDER BY s.name ASC
    `).all() as unknown) as ScriptRecord[];

    return scripts;
  }

  /**
   * Get single script by ID with all versions
   */
  static getScriptById(scriptId: string) {
    const script = db.prepare('SELECT * FROM update_scripts WHERE id = ?').get(scriptId) as ScriptRecord | undefined;
    if (!script) return null;

    const versions = db.prepare(`
      SELECT * FROM update_script_versions
      WHERE script_id = ?
      ORDER BY version_num DESC
    `).all(scriptId);

    return { ...script, versions };
  }

  /**
   * Create a new script with Version 1
   */
  static createScript(
    name: string,
    description: string | undefined,
    targetOs: 'windows' | 'linux' | 'all',
    scriptType: 'powershell' | 'batch' | 'bash',
    scriptContent: string,
    timeoutSeconds: number = 600,
    parametersSchemaJson: string | undefined,
    notes: string | undefined,
    userId: string,
    username: string
  ): ScriptRecord {
    const scriptId = crypto.randomUUID();
    const versionId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO update_scripts (
        id, name, description, target_os, script_type, timeout_seconds,
        parameters_schema_json, is_archived, created_by_user_id, created_by_username, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(scriptId, name.trim(), description?.trim() || null, targetOs, scriptType, timeoutSeconds, parametersSchemaJson || null, userId, username);

    db.prepare(`
      INSERT INTO update_script_versions (
        id, script_id, version_num, script_content, notes, created_by_user_id, created_by_username, created_at
      ) VALUES (?, ?, 1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(versionId, scriptId, scriptContent, notes || 'Initial version', userId, username);

    this.logAudit(userId, username, 'create_script', undefined, undefined, undefined, {
      scriptId,
      name,
      targetOs,
      scriptType,
      timeoutSeconds,
    });

    return this.getScriptById(scriptId)!;
  }

  /**
   * Update script metadata or create a new version
   */
  static updateScript(
    scriptId: string,
    name: string,
    description: string | undefined,
    targetOs: 'windows' | 'linux' | 'all',
    scriptType: 'powershell' | 'batch' | 'bash',
    timeoutSeconds: number,
    parametersSchemaJson: string | undefined,
    newScriptContent: string | undefined,
    notes: string | undefined,
    userId: string,
    username: string
  ): ScriptRecord {
    const existing = db.prepare('SELECT * FROM update_scripts WHERE id = ?').get(scriptId) as ScriptRecord | undefined;
    if (!existing) throw new Error('Script not found');

    db.prepare(`
      UPDATE update_scripts SET
        name = ?, description = ?, target_os = ?, script_type = ?, timeout_seconds = ?,
        parameters_schema_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name.trim(), description?.trim() || null, targetOs, scriptType, timeoutSeconds, parametersSchemaJson || null, scriptId);

    if (newScriptContent && newScriptContent.trim().length > 0) {
      const maxVerRow = db.prepare('SELECT MAX(version_num) as max_ver FROM update_script_versions WHERE script_id = ?').get(scriptId) as { max_ver: number };
      const nextVer = (maxVerRow.max_ver || 0) + 1;

      db.prepare(`
        INSERT INTO update_script_versions (
          id, script_id, version_num, script_content, notes, created_by_user_id, created_by_username, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `).run(crypto.randomUUID(), scriptId, nextVer, newScriptContent, notes || `Version ${nextVer}`, userId, username);
    }

    this.logAudit(userId, username, 'update_script', undefined, undefined, undefined, { scriptId, name });
    return this.getScriptById(scriptId)!;
  }

  /**
   * Delete / archive a script
   */
  static deleteScript(scriptId: string, userId: string, username: string): void {
    const existing = db.prepare('SELECT name FROM update_scripts WHERE id = ?').get(scriptId) as { name: string } | undefined;
    if (!existing) throw new Error('Script not found');

    db.prepare('DELETE FROM update_scripts WHERE id = ?').run(scriptId);
    this.logAudit(userId, username, 'delete_script', undefined, undefined, undefined, { scriptId, name: existing.name });
  }

  /**
   * Deploy script to selected devices passing parameters as environment variables
   */
  static deployScript(
    scriptId: string,
    versionNum: number | undefined,
    deviceIds: string[],
    parameters: Record<string, string>,
    userId: string,
    username: string,
    expiresAt?: string | null
  ): { queuedCount: number; jobIds: string[] } {
    const script = db.prepare('SELECT * FROM update_scripts WHERE id = ?').get(scriptId) as ScriptRecord | undefined;
    if (!script) throw new Error('Script not found');

    let verRow: any;
    if (versionNum) {
      verRow = db.prepare('SELECT * FROM update_script_versions WHERE script_id = ? AND version_num = ?').get(scriptId, versionNum);
    } else {
      verRow = db.prepare('SELECT * FROM update_script_versions WHERE script_id = ? ORDER BY version_num DESC LIMIT 1').get(scriptId);
    }

    if (!verRow) throw new Error('Script version content not found');

    const jobIds: string[] = [];
    const payload = {
      script_id: script.id,
      script_name: script.name,
      script_type: script.script_type,
      target_os: script.target_os,
      script_content: verRow.script_content,
      parameters: parameters || {},
    };

    for (const devId of deviceIds) {
      try {
        const jid = this.queueJob(devId, 'run_script', payload, userId, username, script.timeout_seconds, expiresAt);
        jobIds.push(jid);
      } catch (err: any) {
        console.warn(`[DeployScript] Failed to queue job for device ${devId}:`, err.message);
      }
    }

    // Record complete script content and runtime parameters in immutable audit log
    this.logAudit(userId, username, 'deploy_script', undefined, undefined, undefined, {
      scriptId: script.id,
      scriptName: script.name,
      scriptType: script.script_type,
      versionNum: verRow.version_num,
      targetDeviceIds: deviceIds,
      parameters,
      scriptContent: verRow.script_content,
      jobIds,
    });

    return { queuedCount: jobIds.length, jobIds };
  }

  /**
   * Get jobs list for accessible devices
   */
  static getJobs(userId: string, limit: number = 100) {
    const accessibleDevices = DeviceService.getUserDevices(userId);
    if (accessibleDevices.length === 0) return [];

    const placeholders = accessibleDevices.map(() => '?').join(',');
    return (db.prepare(`
      SELECT uj.*, d.name as device_name
      FROM update_jobs uj
      JOIN devices d ON d.id = uj.device_id
      WHERE uj.device_id IN (${placeholders})
      ORDER BY uj.created_at DESC
      LIMIT ?
    `).all(...accessibleDevices.map((d) => d.id), limit) as unknown) as JobRecord[];
  }

  /**
   * Get audit logs
   */
  static getAuditLogs(userId: string, limit: number = 200) {
    return db.prepare(`
      SELECT * FROM update_audit_logs
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as any[];
  }

  /**
   * Expiry & stuck jobs watchdog (runs periodically)
   */
  static runWatchdogJobCleanup(): void {
    // 1. Expire queued / waiting jobs past expires_at
    db.prepare(`
      UPDATE update_jobs
      SET status = 'failed', stderr = 'Job expired before device came online', completed_at = CURRENT_TIMESTAMP
      WHERE status IN ('queued', 'waiting_for_device') AND expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
    `).run();

    // 2. Mark stuck jobs past timeout + 5 minutes grace (300s)
    const stuckJobs = db.prepare(`
      SELECT id, started_at, timeout_seconds
      FROM update_jobs
      WHERE status IN ('sent', 'downloading', 'running')
        AND started_at IS NOT NULL
        AND (strftime('%s', 'now') - strftime('%s', started_at)) > (timeout_seconds + 300)
    `).all() as Array<{ id: string }>;

    for (const job of stuckJobs) {
      db.prepare(`
        UPDATE update_jobs
        SET status = 'timed_out', stderr = 'Job execution timed out without report from agent', completed_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(job.id);
    }
  }

  /**
   * ==========================================
   * PACKAGE LIBRARY & REPOSITORY
   * ==========================================
   */

  static getPackageStorageDir(): string {
    const dir = path.join(config.dataDir, 'update-packages');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  /**
   * List all packages with version details and fleet installation counts
   */
  static getPackagesList(userId: string): PackageRecord[] {
    const accessibleDevices = DeviceService.getUserDevices(userId);
    const devIds = accessibleDevices.map(d => d.id);
    const placeholders = devIds.length > 0 ? devIds.map(() => '?').join(',') : "''";

    const pkgs = (db.prepare(`
      SELECT p.*
      FROM update_packages p
      ORDER BY p.display_name ASC
    `).all() as unknown) as PackageRecord[];

    for (const pkg of pkgs) {
      const versions = (db.prepare(`
        SELECT v.*
        FROM update_package_versions v
        WHERE v.package_id = ?
        ORDER BY v.created_at DESC
      `).all(pkg.id) as unknown) as PackageVersionRecord[];

      let totalSize = 0;
      for (const v of versions) {
        totalSize += v.file_size_bytes || 0;
        if (devIds.length > 0) {
          const matchName = v.detection_name || pkg.display_name;
          const instCountRow = db.prepare(`
            SELECT COUNT(DISTINCT device_id) as count
            FROM software_inventory
            WHERE device_id IN (${placeholders})
              AND (name LIKE ? OR software_key LIKE ?)
              ${v.detection_version ? 'AND version = ?' : ''}
          `).get(...devIds, `%${matchName}%`, `%${matchName}%`, ...(v.detection_version ? [v.detection_version] : [])) as { count: number };
          v.installed_device_count = instCountRow?.count || 0;
        } else {
          v.installed_device_count = 0;
        }
      }

      pkg.versions = versions;
      pkg.total_size_bytes = totalSize;
      pkg.latest_version = versions.length > 0 ? versions[0].version : undefined;

      if (devIds.length > 0) {
        const pkgMatch = pkg.display_name;
        const totalDevsRow = db.prepare(`
          SELECT COUNT(DISTINCT device_id) as count
          FROM software_inventory
          WHERE device_id IN (${placeholders})
            AND (name LIKE ? OR software_key LIKE ?)
        `).get(...devIds, `%${pkgMatch}%`, `%${pkgMatch}%`) as { count: number };
        pkg.installed_device_count = totalDevsRow?.count || 0;
      } else {
        pkg.installed_device_count = 0;
      }
    }

    return pkgs;
  }

  /**
   * Get single package by ID
   */
  static getPackageById(packageId: string): PackageRecord | null {
    const pkg = db.prepare('SELECT * FROM update_packages WHERE id = ?').get(packageId) as PackageRecord | undefined;
    if (!pkg) return null;

    const versions = (db.prepare(`
      SELECT * FROM update_package_versions
      WHERE package_id = ?
      ORDER BY created_at DESC
    `).all(packageId) as unknown) as PackageVersionRecord[];

    pkg.versions = versions;
    pkg.total_size_bytes = versions.reduce((sum, v) => sum + (v.file_size_bytes || 0), 0);
    pkg.latest_version = versions.length > 0 ? versions[0].version : undefined;
    return pkg;
  }

  /**
   * Create a new package (with optional initial version & file upload)
   */
  static createPackage(
    data: {
      displayName: string;
      description?: string;
      packageSourceType: 'file' | 'winget' | 'apt';
      wingetId?: string;
      aptPackageName?: string;
    },
    versionData?: {
      version: string;
      targetOs: 'windows' | 'linux' | 'all';
      targetArch: 'amd64' | 'arm64' | 'all';
      silentInstallArgs?: string;
      uninstallCommand?: string;
      expectedExitCodes?: string;
      detectionName?: string;
      detectionVersion?: string;
      notes?: string;
    },
    fileBuffer?: Buffer,
    fileName?: string,
    userId?: string,
    username?: string
  ): PackageRecord {
    const packageId = crypto.randomUUID();
    const cleanName = data.displayName.trim();
    if (!cleanName) throw new Error('Package display name is required');

    db.prepare(`
      INSERT INTO update_packages (
        id, display_name, description, package_source_type, winget_id, apt_package_name,
        created_by_user_id, created_by_username, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      packageId,
      cleanName,
      data.description?.trim() || null,
      data.packageSourceType,
      data.wingetId?.trim() || null,
      data.aptPackageName?.trim() || null,
      userId || null,
      username || 'System'
    );

    if (versionData) {
      this.addPackageVersion(packageId, versionData, fileBuffer, fileName, userId, username);
    }

    this.logAudit(userId || 'system', username || 'System', 'create_package', undefined, undefined, packageId, {
      packageId,
      displayName: cleanName,
      packageSourceType: data.packageSourceType,
    });

    return this.getPackageById(packageId)!;
  }

  /**
   * Add a version to an existing package
   */
  static addPackageVersion(
    packageId: string,
    versionData: {
      version: string;
      targetOs: 'windows' | 'linux' | 'all';
      targetArch: 'amd64' | 'arm64' | 'all';
      silentInstallArgs?: string;
      uninstallCommand?: string;
      expectedExitCodes?: string;
      detectionName?: string;
      detectionVersion?: string;
      notes?: string;
    },
    fileBuffer?: Buffer,
    fileName?: string,
    userId?: string,
    username?: string
  ): PackageVersionRecord {
    const pkg = db.prepare('SELECT * FROM update_packages WHERE id = ?').get(packageId) as PackageRecord | undefined;
    if (!pkg) throw new Error('Package not found');

    const versionId = crypto.randomUUID();
    let filePath: string | null = null;
    let fileSha256: string | null = null;
    let fileSize = 0;

    let silentArgs = versionData.silentInstallArgs?.trim();
    let uninstallCmd = versionData.uninstallCommand?.trim();
    let expectedExitCodes = versionData.expectedExitCodes?.trim() || '0,3010,1641';

    if (fileBuffer && fileName) {
      const ext = path.extname(fileName).toLowerCase();
      fileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      fileSize = fileBuffer.length;

      const safeBase = `${pkg.id}_${versionData.version.replace(/[^a-zA-Z0-9._-]/g, '_')}_${versionData.targetOs}_${versionData.targetArch}${ext}`;
      const storageDir = this.getPackageStorageDir();
      filePath = path.join(storageDir, safeBase);
      fs.writeFileSync(filePath, fileBuffer);

      // Pre-fill MSI defaults if user didn't specify
      if (ext === '.msi') {
        if (!silentArgs) silentArgs = '/qn /norestart';
        if (!uninstallCmd) uninstallCmd = `msiexec.exe /x "${fileName}" /qn /norestart`;
      } else if (ext === '.deb') {
        if (!silentArgs) silentArgs = '';
        if (!uninstallCmd) uninstallCmd = `apt-get remove -y ${pkg.apt_package_name || pkg.display_name}`;
      }
    }

    db.prepare(`
      INSERT INTO update_package_versions (
        id, package_id, version, target_os, target_arch, file_path, file_sha256, file_size_bytes,
        silent_install_args, uninstall_command, expected_exit_codes, detection_name, detection_version,
        notes, created_by_user_id, created_by_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      versionId,
      packageId,
      versionData.version.trim(),
      versionData.targetOs,
      versionData.targetArch,
      filePath,
      fileSha256,
      fileSize,
      silentArgs || null,
      uninstallCmd || null,
      expectedExitCodes,
      versionData.detectionName?.trim() || pkg.display_name,
      versionData.detectionVersion?.trim() || versionData.version.trim(),
      versionData.notes?.trim() || null,
      userId || null,
      username || 'System'
    );

    db.prepare('UPDATE update_packages SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(packageId);

    this.logAudit(userId || 'system', username || 'System', 'add_package_version', undefined, undefined, packageId, {
      packageId,
      versionId,
      version: versionData.version,
      fileSize,
      fileSha256,
    });

    return (db.prepare('SELECT * FROM update_package_versions WHERE id = ?').get(versionId) as unknown) as PackageVersionRecord;
  }

  /**
   * Delete single package version
   */
  static deletePackageVersion(versionId: string, userId: string, username: string): void {
    const ver = db.prepare('SELECT * FROM update_package_versions WHERE id = ?').get(versionId) as PackageVersionRecord | undefined;
    if (!ver) throw new Error('Package version not found');

    if (ver.file_path && fs.existsSync(ver.file_path)) {
      try { fs.unlinkSync(ver.file_path); } catch {}
    }

    db.prepare('DELETE FROM update_package_versions WHERE id = ?').run(versionId);
    this.logAudit(userId, username, 'delete_package_version', undefined, undefined, ver.package_id, { versionId, version: ver.version });
  }

  /**
   * Delete entire package and all its versions
   */
  static deletePackage(packageId: string, userId: string, username: string): void {
    const pkg = db.prepare('SELECT * FROM update_packages WHERE id = ?').get(packageId) as PackageRecord | undefined;
    if (!pkg) throw new Error('Package not found');

    const versions = db.prepare('SELECT file_path FROM update_package_versions WHERE package_id = ?').all(packageId) as Array<{ file_path: string }>;
    for (const v of versions) {
      if (v.file_path && fs.existsSync(v.file_path)) {
        try { fs.unlinkSync(v.file_path); } catch {}
      }
    }

    db.prepare('DELETE FROM update_packages WHERE id = ?').run(packageId);
    this.logAudit(userId, username, 'delete_package', undefined, undefined, packageId, { packageId, displayName: pkg.display_name });
  }

  /**
   * Get physical file path for package version download
   */
  static getPackageVersionFile(versionId: string): { filePath: string; fileName: string; sha256: string } | null {
    const ver = db.prepare('SELECT * FROM update_package_versions WHERE id = ?').get(versionId) as PackageVersionRecord | undefined;
    if (!ver || !ver.file_path || !fs.existsSync(ver.file_path)) return null;

    const baseName = path.basename(ver.file_path);
    return {
      filePath: ver.file_path,
      fileName: baseName,
      sha256: ver.file_sha256 || '',
    };
  }

  /**
   * ==========================================
   * INSTALL / UNINSTALL WORKFLOWS
   * ==========================================
   */

  /**
   * Queue package install across multiple target devices
   */
  static queuePackageInstall(
    packageVersionId: string,
    deviceIds: string[],
    customArgs: string | undefined,
    userId: string,
    username: string,
    expiresAt?: string | null
  ): { queuedCount: number; jobIds: string[] } {
    const ver = db.prepare('SELECT * FROM update_package_versions WHERE id = ?').get(packageVersionId) as PackageVersionRecord | undefined;
    if (!ver) throw new Error('Package version not found');

    const pkg = db.prepare('SELECT * FROM update_packages WHERE id = ?').get(ver.package_id) as PackageRecord | undefined;
    if (!pkg) throw new Error('Package definition not found');

    const jobIds: string[] = [];

    const payload = {
      package_id: pkg.id,
      version_id: ver.id,
      package_name: pkg.display_name,
      version: ver.version,
      source_type: pkg.package_source_type,
      winget_id: pkg.winget_id,
      apt_package_name: pkg.apt_package_name,
      download_path: ver.file_path ? `/api/updates/packages/download/${ver.id}` : null,
      file_sha256: ver.file_sha256,
      file_size_bytes: ver.file_size_bytes,
      silent_install_args: customArgs || ver.silent_install_args || '',
      expected_exit_codes: ver.expected_exit_codes || '0,3010,1641',
      detection_name: ver.detection_name || pkg.display_name,
      detection_version: ver.detection_version || ver.version,
    };

    for (const devId of deviceIds) {
      try {
        const jid = this.queueJob(devId, 'install', payload, userId, username, 1800, expiresAt);
        jobIds.push(jid);
      } catch (err: any) {
        console.warn(`[PackageInstall] Skipped device ${devId}:`, err.message);
      }
    }

    this.logAudit(userId, username, 'queue_package_install', undefined, undefined, pkg.id, {
      packageId: pkg.id,
      versionId: ver.id,
      packageName: pkg.display_name,
      version: ver.version,
      deviceIds,
      jobIds,
    });

    return { queuedCount: jobIds.length, jobIds };
  }

  /**
   * Queue remote uninstall for an inventory item on a device
   */
  static queueUninstall(
    deviceId: string,
    inventoryId: string,
    customCommand: string | undefined,
    userId: string,
    username: string,
    expiresAt?: string | null
  ): string {
    const item = db.prepare('SELECT * FROM software_inventory WHERE id = ? AND device_id = ?').get(inventoryId, deviceId) as any;
    if (!item) throw new Error('Software inventory item not found on this device');

    if (item.is_per_user === 1) {
      throw new Error('Per-user installs cannot be remotely uninstalled. Remote removal is restricted to machine-wide installs.');
    }

    let uninstallCmd = customCommand?.trim();

    if (!uninstallCmd) {
      if (item.quiet_uninstall_string && item.quiet_uninstall_string.trim().length > 0) {
        uninstallCmd = item.quiet_uninstall_string.trim();
      } else if (item.msi_product_code) {
        uninstallCmd = `MsiExec.exe /X${item.msi_product_code} /qn /norestart`;
      } else if (item.source === 'winget') {
        uninstallCmd = `winget uninstall --id ${item.name} --exact --scope machine --source winget --accept-source-agreements --disable-interactivity`;
      } else if (item.source === 'dpkg') {
        uninstallCmd = `apt-get remove -y ${item.name}`;
      } else if (item.source === 'snap') {
        uninstallCmd = `snap remove ${item.name}`;
      } else if (item.uninstall_string && (item.uninstall_string.includes('/qn') || item.uninstall_string.includes('/quiet') || item.uninstall_string.includes('/S') || item.uninstall_string.includes('/verysilent'))) {
        uninstallCmd = item.uninstall_string;
      }
    }

    if (!uninstallCmd) {
      throw new Error('No silent uninstall command is known for this application. Please provide a verified custom silent command.');
    }

    const payload = {
      inventory_id: item.id,
      software_key: item.software_key,
      name: item.name,
      version: item.version,
      source: item.source,
      uninstall_command: uninstallCmd,
    };

    return this.queueJob(deviceId, 'uninstall', payload, userId, username, 1200, expiresAt);
  }

  /**
   * ==========================================
   * AVAILABLE UPDATES & PINNING
   * ==========================================
   */

  /**
   * Get available updates for user's accessible devices
   */
  static getAvailableUpdatesList(userId: string) {
    const accessibleDevices = DeviceService.getUserDevices(userId);
    if (accessibleDevices.length === 0) return { updates: [], appGroups: [] };

    const placeholders = accessibleDevices.map(() => '?').join(',');
    const devMap = new Map(accessibleDevices.map(d => [d.id, d.name]));

    const rows = db.prepare(`
      SELECT dau.*, d.name as device_name
      FROM device_available_updates dau
      JOIN devices d ON d.id = dau.device_id
      WHERE dau.device_id IN (${placeholders})
      ORDER BY dau.name ASC, dau.available_version DESC
    `).all(...accessibleDevices.map(d => d.id)) as any[];

    // Fetch pins for filtering / decorating
    const pins = db.prepare('SELECT * FROM update_pins').all() as unknown as AppPinRecord[];

    const decorated = rows.map(r => {
      const globalPin = pins.find(p => p.app_name.toLowerCase() === r.name.toLowerCase() && !p.device_id);
      const devPin = pins.find(p => p.app_name.toLowerCase() === r.name.toLowerCase() && p.device_id === r.device_id);
      const activePin = devPin || globalPin || null;

      return {
        id: r.id,
        deviceId: r.device_id,
        deviceName: r.device_name || devMap.get(r.device_id) || 'Unknown',
        name: r.name,
        currentVersion: r.current_version,
        availableVersion: r.available_version,
        packageIdentifier: r.package_identifier,
        source: r.source,
        isSecurity: Boolean(r.is_security),
        requiresReboot: Boolean(r.requires_reboot),
        detectedAt: r.detected_at,
        pin: activePin,
        isIgnored: activePin?.pin_type === 'ignore' || (activePin?.pin_type === 'pin_version' && activePin.pinned_version === r.current_version),
      };
    });

    // Group by App
    const groupMap = new Map<string, any>();
    for (const item of decorated) {
      if (!groupMap.has(item.name)) {
        groupMap.set(item.name, {
          name: item.name,
          packageIdentifier: item.packageIdentifier,
          availableVersion: item.availableVersion,
          source: item.source,
          isSecurity: item.isSecurity,
          requiresReboot: item.requiresReboot,
          pin: item.pin,
          devices: [],
        });
      }
      const g = groupMap.get(item.name);
      if (item.isSecurity) g.isSecurity = true;
      if (item.requiresReboot) g.requiresReboot = true;
      g.devices.push(item);
    }

    return {
      updates: decorated,
      appGroups: Array.from(groupMap.values()),
    };
  }

  /**
   * Queue single app upgrade on device
   */
  static queueAppUpgrade(
    deviceId: string,
    updateId: string,
    userId: string,
    username: string,
    expiresAt?: string | null
  ): string {
    const upd = db.prepare('SELECT * FROM device_available_updates WHERE id = ? AND device_id = ?').get(updateId, deviceId) as any;
    if (!upd) throw new Error('Available update not found for device');

    const payload = {
      update_id: upd.id,
      name: upd.name,
      current_version: upd.current_version,
      available_version: upd.available_version,
      package_identifier: upd.package_identifier,
      source: upd.source,
    };

    return this.queueJob(deviceId, 'upgrade', payload, userId, username, 1800, expiresAt);
  }

  /**
   * Queue fleet upgrade for an app across all devices where an update is detected
   */
  static queueFleetAppUpgrade(
    appName: string,
    packageIdentifier?: string,
    availableVersion?: string,
    deviceIds?: string[],
    userId?: string,
    username?: string,
    expiresAt?: string | null
  ): { queuedCount: number; jobIds: string[] } {
    const accessibleDevices = DeviceService.getUserDevices(userId || 'system');
    if (accessibleDevices.length === 0) return { queuedCount: 0, jobIds: [] };

    const placeholders = accessibleDevices.map(() => '?').join(',');
    let query = `
      SELECT id, device_id, name, current_version, available_version, package_identifier, source
      FROM device_available_updates
      WHERE device_id IN (${placeholders}) AND name = ?
    `;
    const params: any[] = [...accessibleDevices.map(d => d.id), appName];

    if (deviceIds && deviceIds.length > 0) {
      const devPlaceholders = deviceIds.map(() => '?').join(',');
      query += ` AND device_id IN (${devPlaceholders})`;
      params.push(...deviceIds);
    }

    const updates = db.prepare(query).all(...params) as any[];
    const jobIds: string[] = [];

    for (const u of updates) {
      try {
        const payload = {
          update_id: u.id,
          name: u.name,
          current_version: u.current_version,
          available_version: availableVersion || u.available_version,
          package_identifier: packageIdentifier || u.package_identifier,
          source: u.source,
        };
        const jid = this.queueJob(u.device_id, 'upgrade', payload, userId || 'system', username || 'System', 1800, expiresAt);
        jobIds.push(jid);
      } catch (err: any) {
        console.warn(`[FleetUpgrade] Failed to queue upgrade on device ${u.device_id}:`, err.message);
      }
    }

    this.logAudit(userId || 'system', username || 'System', 'fleet_app_upgrade', undefined, undefined, undefined, {
      appName,
      packageIdentifier,
      availableVersion,
      queuedCount: jobIds.length,
      jobIds,
    });

    return { queuedCount: jobIds.length, jobIds };
  }

  /**
   * Check for updates on all accessible monitored devices
   */
  static checkUpdatesAllDevices(userId: string, username: string): { queuedCount: number } {
    const accessibleDevices = DeviceService.getUserDevices(userId);
    let queuedCount = 0;

    for (const d of accessibleDevices) {
      const agent = db.prepare('SELECT id FROM monitoring_agents WHERE device_id = ?').get(d.id);
      if (agent) {
        this.queueJob(d.id, 'check_updates', {}, userId, username, 600);
        queuedCount++;
      }
    }

    this.logAudit(userId, username, 'check_updates_all_devices', undefined, undefined, undefined, { queuedCount });
    return { queuedCount };
  }

  /**
   * Check for updates on a single device
   */
  static checkUpdatesSingleDevice(deviceId: string, userId: string, username: string): string {
    return this.queueJob(deviceId, 'check_updates', {}, userId, username, 600);
  }

  /**
   * Get all registered app pins
   */
  static getAppPins(userId: string): AppPinRecord[] {
    const accessibleDevices = DeviceService.getUserDevices(userId);
    const devMap = new Map(accessibleDevices.map(d => [d.id, d.name]));

    const pins = db.prepare('SELECT * FROM update_pins ORDER BY created_at DESC').all() as any[];
    return pins.map(p => ({
      ...p,
      device_name: p.device_id ? (devMap.get(p.device_id) || 'Unknown Device') : 'Global (All Devices)',
    }));
  }

  /**
   * Set app pin (global or device-specific)
   */
  static setAppPin(
    appName: string,
    pinType: 'ignore' | 'pin_version',
    pinnedVersion?: string | null,
    deviceId?: string | null,
    reason?: string | null,
    userId?: string,
    username?: string
  ): AppPinRecord {
    const cleanApp = appName.trim();
    if (!cleanApp) throw new Error('App name is required');

    // Remove existing pin for this scope
    if (deviceId) {
      db.prepare('DELETE FROM update_pins WHERE app_name = ? AND device_id = ?').run(cleanApp, deviceId);
    } else {
      db.prepare('DELETE FROM update_pins WHERE app_name = ? AND device_id IS NULL').run(cleanApp);
    }

    const pinId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO update_pins (
        id, device_id, app_name, pin_type, pinned_version, reason,
        created_by_user_id, created_by_username, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      pinId,
      deviceId || null,
      cleanApp,
      pinType,
      pinnedVersion || null,
      reason || null,
      userId || null,
      username || 'System'
    );

    this.logAudit(userId || 'system', username || 'System', 'set_app_pin', deviceId || undefined, undefined, undefined, {
      pinId,
      appName: cleanApp,
      pinType,
      pinnedVersion,
      deviceId,
    });

    return db.prepare('SELECT * FROM update_pins WHERE id = ?').get(pinId) as unknown as AppPinRecord;
  }

  /**
   * Delete an app pin
   */
  static deleteAppPin(pinId: string, userId: string, username: string): void {
    const pin = db.prepare('SELECT * FROM update_pins WHERE id = ?').get(pinId) as unknown as AppPinRecord | undefined;
    if (!pin) throw new Error('Pin not found');

    db.prepare('DELETE FROM update_pins WHERE id = ?').run(pinId);
    this.logAudit(userId, username, 'delete_app_pin', pin.device_id || undefined, undefined, undefined, {
      pinId,
      appName: pin.app_name,
    });
  }
}
