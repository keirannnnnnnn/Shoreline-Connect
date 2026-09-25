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
      WHERE device_id = ? AND status IN ('queued', 'waiting_for_device')
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
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

    const latestVersion = this.getLatestServerAgentVersion();
    const agentsWithVer = db.prepare(`
      SELECT status, last_seen_at, agent_version
      FROM monitoring_agents
      WHERE device_id IN (${placeholders})
    `).all(...deviceIds) as Array<{ status: string; last_seen_at: string | null; agent_version: string | null }>;

    const now = Date.now();
    const agentsOnline = agentsWithVer.filter(a => a.status === 'online' && a.last_seen_at && (now - new Date(a.last_seen_at).getTime() <= 45000)).length;
    const agentsOutOfDate = agentsWithVer.filter(a => (a.agent_version || '') !== latestVersion).length;

    return {
      devicesWithUpdates: updatesRow.count || 0,
      failedJobsLast7Days: failedJobsRow.count || 0,
      devicesPendingReboot: rebootRow.count || 0,
      detectionUnavailable: 0,
      agentsOutOfDate,
      totalTrackedSoftware: softwareCountRow.count || 0,
      totalMonitoredAgents: agentsWithVer.length,
      agentsOnline,
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

    return '1.1.0';
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
}
