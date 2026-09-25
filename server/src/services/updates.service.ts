import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { db } from '../db/database.js';
import { config } from '../config/env.js';
import { DeviceService } from './device.service.js';

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
  source: string;
  isSecurity?: boolean;
  requiresReboot?: boolean;
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
  expires_at: string;
  created_by_user_id?: string | null;
  created_by_username: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

export class UpdatesService {
  private static MAX_LOG_BYTES = 65536; // 64KB log limit

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
        id, device_id, name, current_version, available_version, source,
        is_security, requires_reboot, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);

    for (const u of updates) {
      if (!u.name || !u.availableVersion) continue;
      insertStmt.run(
        crypto.randomUUID(),
        deviceId,
        u.name,
        u.currentVersion || null,
        u.availableVersion,
        u.source || 'winget',
        u.isSecurity ? 1 : 0,
        u.requiresReboot ? 1 : 0
      );
    }
  }

  /**
   * Fetch the next pending job for an agent on its 15s check-in cycle
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

    const nextJob = db.prepare(`
      SELECT * FROM update_jobs
      WHERE device_id = ? AND status = 'queued' AND expires_at > CURRENT_TIMESTAMP
      ORDER BY created_at ASC
      LIMIT 1
    `).get(deviceId) as JobRecord | undefined;

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
    const validStatuses = ['sent', 'downloading', 'running', 'succeeded', 'failed', 'timed_out', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid job status: ${status}`);
    }

    const isTerminal = ['succeeded', 'failed', 'timed_out', 'cancelled'].includes(status);
    const truncOut = this.truncateLog(stdout);
    const truncErr = this.truncateLog(stderr);
    const rebootInt = rebootRequired ? 1 : 0;
    const matchInt = detectionMatched !== undefined && detectionMatched !== null ? (detectionMatched ? 1 : 0) : null;

    if (isTerminal) {
      db.prepare(`
        UPDATE update_jobs
        SET status = ?, exit_code = ?, stdout = ?, stderr = ?, reboot_required = ?, detection_matched = ?, completed_at = CURRENT_TIMESTAMP
        WHERE id = ? AND device_id = ?
      `).run(status, exitCode !== undefined ? exitCode : null, truncOut, truncErr, rebootInt, matchInt, jobId, deviceId);
    } else {
      db.prepare(`
        UPDATE update_jobs
        SET status = ?, stdout = COALESCE(?, stdout), stderr = COALESCE(?, stderr), reboot_required = ?
        WHERE id = ? AND device_id = ?
      `).run(status, truncOut, truncErr, rebootInt, jobId, deviceId);
    }
  }

  /**
   * Queue a new update job
   */
  static queueJob(
    deviceId: string,
    jobType: string,
    payload: any,
    userId: string,
    username: string,
    timeoutSeconds: number = 1800
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
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
      INSERT INTO update_jobs (
        id, device_id, job_type, status, payload_json, timeout_seconds, expires_at,
        created_by_user_id, created_by_username, created_at
      ) VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(jobId, deviceId, jobType, JSON.stringify(payload || {}), timeoutSeconds, expiresAt, userId, username);

    // Audit log
    this.logAudit(userId, username, `queue_job_${jobType}`, deviceId, deviceData.device.name, undefined, {
      jobId,
      jobType,
      payload,
    });

    return jobId;
  }

  /**
   * Cancel a queued job
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

    if (job.status !== 'queued') {
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

    // 3. Devices pending reboot (from latest jobs or monitoring flags)
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

    return {
      devicesWithUpdates: updatesRow.count || 0,
      failedJobsLast7Days: failedJobsRow.count || 0,
      devicesPendingReboot: rebootRow.count || 0,
      detectionUnavailable: 0,
      agentsOutOfDate: 0,
      totalTrackedSoftware: softwareCountRow.count || 0,
    };
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
    // 1. Expire queued jobs past expires_at
    const expiredCount = db.prepare(`
      UPDATE update_jobs
      SET status = 'failed', stderr = 'Job expired before device came online', completed_at = CURRENT_TIMESTAMP
      WHERE status = 'queued' AND expires_at <= CURRENT_TIMESTAMP
    `).run().changes;

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
}
