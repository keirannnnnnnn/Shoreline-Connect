import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import Busboy from 'busboy';
import { authenticateUser, requireTabAccess, requireTabAdmin, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { UpdatesService } from '../services/updates.service.js';
import { MonitoringService } from '../services/monitoring.service.js';
import { DeviceService } from '../services/device.service.js';

export const updatesRouter = Router();

// Middleware: Authenticate agent requests via Bearer token
function authenticateAgent(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing agent bearer token' });
  }

  const rawToken = authHeader.substring(7).trim();
  const auth = MonitoringService.authenticateAgentToken(rawToken);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized: Invalid agent token' });
  }

  (req as any).agentAuth = auth;
  next();
}

/* ==========================================================================
   AGENT API ENDPOINTS (Token Auth)
   ========================================================================== */

/**
 * Ingest full software inventory scan from agent
 */
updatesRouter.post('/agent/inventory', authenticateAgent, (req: Request, res: Response) => {
  try {
    const { deviceId } = (req as any).agentAuth;
    const { items, rebootRequired } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    const result = UpdatesService.syncInventory(deviceId, items);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Ingest available updates list from agent
 */
updatesRouter.post('/agent/updates', authenticateAgent, (req: Request, res: Response) => {
  try {
    const { deviceId } = (req as any).agentAuth;
    const { updates } = req.body;

    if (!Array.isArray(updates)) {
      return res.status(400).json({ error: 'Updates array is required' });
    }

    UpdatesService.replaceAvailableUpdates(deviceId, updates);
    return res.json({ success: true, count: updates.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Agent reports job execution status & output
 */
updatesRouter.post('/agent/jobs/:id/report', authenticateAgent, (req: Request, res: Response) => {
  try {
    const { deviceId } = (req as any).agentAuth;
    const jobId = req.params.id;
    const { status, exitCode, stdout, stderr, rebootRequired, detectionMatched } = req.body;

    if (!status) {
      return res.status(400).json({ error: 'Status is required' });
    }

    UpdatesService.reportJobStatus(
      jobId,
      deviceId,
      status,
      exitCode,
      stdout,
      stderr,
      rebootRequired,
      detectionMatched
    );

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Download specific agent build binary (by buildId)
 */
updatesRouter.get('/agent/download-build/:buildId', (req: Request, res: Response) => {
  const { buildId } = req.params;
  const builds = UpdatesService.getAgentBuilds();
  const build = builds.find(b => b.id === buildId);

  if (!build || !fs.existsSync(build.file_path)) {
    return res.status(404).json({ error: 'Agent build not found' });
  }

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(build.file_path)}"`);
  return fs.createReadStream(build.file_path).pipe(res);
});

/**
 * Download default precompiled agent binary by filename
 */
updatesRouter.get('/agent/download/:filename', (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);

  const candidatePaths = [
    path.resolve(UpdatesService.getAgentBinariesDir(), filename),
    path.resolve(__dirname, '../../agents', filename),
    path.resolve(__dirname, '../../../agents', filename),
    path.resolve(__dirname, '../../../agent/dist', filename),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return fs.createReadStream(p).pipe(res);
    }
  }

  return res.status(404).json({ error: `Agent binary '${filename}' not found` });
});

/* ==========================================================================
   USER & ADMIN API ENDPOINTS (UI)
   ========================================================================== */

const updatesUserAuth = [authenticateUser, requireTabAccess('updates')];
const updatesAdminAuth = [authenticateUser, requireTabAccess('updates'), requireTabAdmin('updates')];

/**
 * Get fleet Updates overview KPIs
 */
updatesRouter.get('/overview', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const overview = UpdatesService.getOverview(req.user!.userId);
    return res.json(overview);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get fleet software inventory
 */
updatesRouter.get('/inventory', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const search = req.query.q as string | undefined;
    const inventory = UpdatesService.getFleetInventory(req.user!.userId, search);
    return res.json(inventory);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get software inventory for specific device
 */
updatesRouter.get('/inventory/device/:deviceId', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = UpdatesService.getDeviceInventory(req.params.deviceId, req.user!.userId);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Rescan single device
 */
updatesRouter.post('/inventory/rescan/:deviceId', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const jobId = UpdatesService.queueJob(req.params.deviceId, 'inventory_scan', {}, req.user!.userId, req.user!.username, 600);
    return res.json({ success: true, jobId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Rescan ALL monitored devices
 */
updatesRouter.post('/inventory/rescan-all', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = UpdatesService.rescanAllDevices(req.user!.userId, req.user!.username);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get fleet agents list
 */
updatesRouter.get('/agents', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const agents = UpdatesService.getAgentsList(req.user!.userId);
    return res.json(agents);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get agent builds
 */
updatesRouter.get('/agents/builds', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const builds = UpdatesService.getAgentBuilds();
    return res.json(builds);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Upload new agent build binary (Admin only)
 */
updatesRouter.post('/agents/upload', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const bb = Busboy({ headers: req.headers });
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('file', (fieldname, file) => {
      const chunks: Buffer[] = [];
      file.on('data', (data) => chunks.push(data));
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('finish', () => {
      if (!fileBuffer || fileBuffer.length === 0) {
        return res.status(400).json({ error: 'No binary file uploaded' });
      }

      const version = fields.version || '1.1.0';
      const targetOs = (fields.target_os as any) || 'windows';
      const targetArch = (fields.target_arch as any) || 'amd64';
      const notes = fields.notes || '';

      if (!['windows', 'linux'].includes(targetOs)) {
        return res.status(400).json({ error: 'Invalid target OS' });
      }
      if (!['amd64', 'arm64'].includes(targetArch)) {
        return res.status(400).json({ error: 'Invalid target architecture' });
      }

      const record = UpdatesService.saveAgentBuild(
        version,
        targetOs,
        targetArch,
        fileBuffer,
        notes,
        req.user!.userId,
        req.user!.username
      );

      return res.json({ success: true, build: record });
    });

    req.pipe(bb);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Promote an agent build to install default (Admin only)
 */
updatesRouter.post('/agents/default-build/:id', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    UpdatesService.setInstallDefaultAgentBuild(req.params.id, req.user!.userId, req.user!.username);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Delete an agent build (Admin only)
 */
updatesRouter.delete('/agents/builds/:id', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    UpdatesService.deleteAgentBuild(req.params.id, req.user!.userId, req.user!.username);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger agent self-update on a device (Admin only)
 */
updatesRouter.post('/agent/self-update/:deviceId', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { buildId, expiresAt } = req.body || {};
    const jobId = UpdatesService.queueAgentUpdate(
      req.params.deviceId,
      buildId || null,
      req.user!.userId,
      req.user!.username,
      expiresAt || null
    );
    return res.json({ success: true, jobId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger fleet agent self-update across multiple devices (Admin only)
 */
updatesRouter.post('/agents/update-fleet', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceIds, buildId, expiresAt } = req.body;
    if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
      return res.status(400).json({ error: 'deviceIds array is required' });
    }

    const result = UpdatesService.queueFleetAgentUpdate(
      deviceIds,
      buildId || null,
      req.user!.userId,
      req.user!.username,
      expiresAt || null
    );
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger agent self-update for all outdated agents (Admin only)
 */
updatesRouter.post('/agents/update-outdated', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { expiresAt } = req.body || {};
    const result = UpdatesService.updateAllOutdatedAgents(
      req.user!.userId,
      req.user!.username,
      expiresAt || null
    );
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   SCRIPT LIBRARY API ENDPOINTS (PHASE 2)
   ========================================================================== */

/**
 * List scripts
 */
updatesRouter.get('/scripts', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const scripts = UpdatesService.getScripts();
    return res.json(scripts);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get script by ID with version history
 */
updatesRouter.get('/scripts/:id', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const script = UpdatesService.getScriptById(req.params.id);
    if (!script) return res.status(404).json({ error: 'Script not found' });
    return res.json(script);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Create new script (Admin only)
 */
updatesRouter.post('/scripts', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description, targetOs, scriptType, scriptContent, timeoutSeconds, parametersSchemaJson, notes } = req.body;

    if (!name || !scriptType || !scriptContent) {
      return res.status(400).json({ error: 'Name, scriptType, and scriptContent are required' });
    }

    const script = UpdatesService.createScript(
      name,
      description,
      targetOs || 'all',
      scriptType,
      scriptContent,
      timeoutSeconds || 600,
      typeof parametersSchemaJson === 'object' ? JSON.stringify(parametersSchemaJson) : parametersSchemaJson,
      notes,
      req.user!.userId,
      req.user!.username
    );

    return res.json({ success: true, script });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Update script / add version (Admin only)
 */
updatesRouter.put('/scripts/:id', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, description, targetOs, scriptType, timeoutSeconds, parametersSchemaJson, scriptContent, notes } = req.body;

    const script = UpdatesService.updateScript(
      req.params.id,
      name,
      description,
      targetOs || 'all',
      scriptType,
      timeoutSeconds || 600,
      typeof parametersSchemaJson === 'object' ? JSON.stringify(parametersSchemaJson) : parametersSchemaJson,
      scriptContent,
      notes,
      req.user!.userId,
      req.user!.username
    );

    return res.json({ success: true, script });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Delete script (Admin only)
 */
updatesRouter.delete('/scripts/:id', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    UpdatesService.deleteScript(req.params.id, req.user!.userId, req.user!.username);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Deploy script to target devices (Admin only)
 */
updatesRouter.post('/deploy/script', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { scriptId, versionNum, deviceIds, parameters, expiresAt } = req.body;

    if (!scriptId || !Array.isArray(deviceIds) || deviceIds.length === 0) {
      return res.status(400).json({ error: 'scriptId and deviceIds array are required' });
    }

    const result = UpdatesService.deployScript(
      scriptId,
      versionNum,
      deviceIds,
      parameters || {},
      req.user!.userId,
      req.user!.username,
      expiresAt || null
    );

    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   JOBS & AUDIT API ENDPOINTS
   ========================================================================== */

/**
 * Get jobs queue and history
 */
updatesRouter.get('/jobs', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const jobs = UpdatesService.getJobs(req.user!.userId, limit);
    return res.json(jobs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Cancel a job
 */
updatesRouter.post('/jobs/:id/cancel', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const isAdmin = (req.user as any).permissions?.tabs?.updates?.isAdmin || req.user!.role === 'admin';
    UpdatesService.cancelJob(req.params.id, req.user!.userId, req.user!.username, isAdmin);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Bulk cancel jobs
 */
updatesRouter.post('/jobs/bulk-cancel', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { jobIds } = req.body;
    if (!Array.isArray(jobIds) || jobIds.length === 0) {
      return res.status(400).json({ error: 'jobIds array is required' });
    }
    const isAdmin = (req.user as any).permissions?.tabs?.updates?.isAdmin || req.user!.role === 'admin';
    const result = UpdatesService.cancelJobsBulk(jobIds, req.user!.userId, req.user!.username, isAdmin);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get audit logs
 */
updatesRouter.get('/audit', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 200;
    const logs = UpdatesService.getAuditLogs(req.user!.userId, limit);
    return res.json(logs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   PACKAGE LIBRARY & INSTALL / UNINSTALL ENDPOINTS
   ========================================================================== */

/**
 * Download package installer binary (supports Agent Bearer token OR Authenticated User)
 */
updatesRouter.get('/packages/download/:versionId', (req: Request, res: Response) => {
  try {
    // 1. Check Agent Token
    let isAuthed = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const rawToken = authHeader.substring(7).trim();
      const agentAuth = MonitoringService.authenticateAgentToken(rawToken);
      if (agentAuth) {
        isAuthed = true;
      }
    }

    // 2. If not agent, check user cookie / auth
    if (!isAuthed) {
      authenticateUser(req as any, res, () => {
        isAuthed = true;
      });
    }

    const fileInfo = UpdatesService.getPackageVersionFile(req.params.versionId);
    if (!fileInfo || !fs.existsSync(fileInfo.filePath)) {
      return res.status(404).json({ error: 'Package version binary not found' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${fileInfo.fileName}"`);
    return fs.createReadStream(fileInfo.filePath).pipe(res);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * List all packages
 */
updatesRouter.get('/packages', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pkgs = UpdatesService.getPackagesList(req.user!.userId);
    return res.json(pkgs);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get package details by ID
 */
updatesRouter.get('/packages/:id', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pkg = UpdatesService.getPackageById(req.params.id);
    if (!pkg) return res.status(404).json({ error: 'Package not found' });
    return res.json(pkg);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Create a new package (with optional file upload)
 */
updatesRouter.post('/packages', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const isMultipart = req.headers['content-type']?.includes('multipart/form-data');

    if (!isMultipart) {
      const { displayName, description, packageSourceType, wingetId, aptPackageName, versionData } = req.body;
      const pkg = UpdatesService.createPackage(
        { displayName, description, packageSourceType: packageSourceType || 'winget', wingetId, aptPackageName },
        versionData,
        undefined,
        undefined,
        req.user!.userId,
        req.user!.username
      );
      return res.json({ success: true, package: pkg });
    }

    const bb = Busboy({ headers: req.headers });
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let fileName: string | undefined = undefined;

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('file', (fieldname, file, info) => {
      fileName = info.filename;
      const chunks: Buffer[] = [];
      file.on('data', (data) => chunks.push(data));
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('finish', () => {
      try {
        const displayName = fields.displayName || fields.display_name;
        if (!displayName) {
          return res.status(400).json({ error: 'Display name is required' });
        }

        const packageSourceType = (fields.packageSourceType || fields.package_source_type || 'file') as any;
        let versionData: any = undefined;

        if (fields.version) {
          versionData = {
            version: fields.version,
            targetOs: fields.targetOs || fields.target_os || 'windows',
            targetArch: fields.targetArch || fields.target_arch || 'amd64',
            silentInstallArgs: fields.silentInstallArgs || fields.silent_install_args,
            uninstallCommand: fields.uninstallCommand || fields.uninstall_command,
            expectedExitCodes: fields.expectedExitCodes || fields.expected_exit_codes || '0,3010,1641',
            detectionName: fields.detectionName || fields.detection_name,
            detectionVersion: fields.detectionVersion || fields.detection_version,
            notes: fields.notes,
          };
        }

        const pkg = UpdatesService.createPackage(
          {
            displayName,
            description: fields.description,
            packageSourceType,
            wingetId: fields.wingetId || fields.winget_id,
            aptPackageName: fields.aptPackageName || fields.apt_package_name,
          },
          versionData,
          fileBuffer || undefined,
          fileName,
          req.user!.userId,
          req.user!.username
        );

        return res.json({ success: true, package: pkg });
      } catch (innerErr: any) {
        return res.status(500).json({ error: innerErr.message });
      }
    });

    req.pipe(bb);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Add a version to an existing package (with optional file upload)
 */
updatesRouter.post('/packages/:id/versions', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const packageId = req.params.id;
    const isMultipart = req.headers['content-type']?.includes('multipart/form-data');

    if (!isMultipart) {
      const version = UpdatesService.addPackageVersion(
        packageId,
        req.body,
        undefined,
        undefined,
        req.user!.userId,
        req.user!.username
      );
      return res.json({ success: true, version });
    }

    const bb = Busboy({ headers: req.headers });
    const fields: Record<string, string> = {};
    let fileBuffer: Buffer | null = null;
    let fileName: string | undefined = undefined;

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('file', (fieldname, file, info) => {
      fileName = info.filename;
      const chunks: Buffer[] = [];
      file.on('data', (data) => chunks.push(data));
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });

    bb.on('finish', () => {
      try {
        if (!fields.version) {
          return res.status(400).json({ error: 'Version number is required' });
        }

        const versionData = {
          version: fields.version,
          targetOs: (fields.targetOs || fields.target_os || 'windows') as any,
          targetArch: (fields.targetArch || fields.target_arch || 'amd64') as any,
          silentInstallArgs: fields.silentInstallArgs || fields.silent_install_args,
          uninstallCommand: fields.uninstallCommand || fields.uninstall_command,
          expectedExitCodes: fields.expectedExitCodes || fields.expected_exit_codes || '0,3010,1641',
          detectionName: fields.detectionName || fields.detection_name,
          detectionVersion: fields.detectionVersion || fields.detection_version,
          notes: fields.notes,
        };

        const version = UpdatesService.addPackageVersion(
          packageId,
          versionData,
          fileBuffer || undefined,
          fileName,
          req.user!.userId,
          req.user!.username
        );

        return res.json({ success: true, version });
      } catch (innerErr: any) {
        return res.status(500).json({ error: innerErr.message });
      }
    });

    req.pipe(bb);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Delete a package version
 */
updatesRouter.delete('/packages/versions/:versionId', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    UpdatesService.deletePackageVersion(req.params.versionId, req.user!.userId, req.user!.username);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Delete entire package
 */
updatesRouter.delete('/packages/:id', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    UpdatesService.deletePackage(req.params.id, req.user!.userId, req.user!.username);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Queue Package Install across selected devices (Wizard Submission)
 */
updatesRouter.post('/install', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { packageVersionId, deviceIds, customArgs, expiresAt } = req.body;
    if (!packageVersionId || !Array.isArray(deviceIds) || deviceIds.length === 0) {
      return res.status(400).json({ error: 'packageVersionId and deviceIds array are required' });
    }

    const result = UpdatesService.queuePackageInstall(
      packageVersionId,
      deviceIds,
      customArgs,
      req.user!.userId,
      req.user!.username,
      expiresAt || null
    );

    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Queue Remote Uninstall for an inventory item
 */
updatesRouter.post('/uninstall', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId, inventoryId, customCommand, expiresAt } = req.body;
    if (!deviceId || !inventoryId) {
      return res.status(400).json({ error: 'deviceId and inventoryId are required' });
    }

    const jobId = UpdatesService.queueUninstall(
      deviceId,
      inventoryId,
      customCommand,
      req.user!.userId,
      req.user!.username,
      expiresAt || null
    );

    return res.json({ success: true, jobId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   AVAILABLE UPDATES & UPGRADE ENDPOINTS
   ========================================================================== */

/**
 * Get available updates list
 */
updatesRouter.get('/available', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = UpdatesService.getAvailableUpdatesList(req.user!.userId);
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Queue app upgrade on single device
 */
updatesRouter.post('/upgrade', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { deviceId, updateId, expiresAt } = req.body;
    if (!deviceId || !updateId) {
      return res.status(400).json({ error: 'deviceId and updateId are required' });
    }

    const jobId = UpdatesService.queueAppUpgrade(
      deviceId,
      updateId,
      req.user!.userId,
      req.user!.username,
      expiresAt || null
    );

    return res.json({ success: true, jobId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Queue fleet app upgrade across all devices with update detected
 */
updatesRouter.post('/upgrade-fleet', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { appName, packageIdentifier, availableVersion, deviceIds, expiresAt } = req.body;
    if (!appName) {
      return res.status(400).json({ error: 'appName is required' });
    }

    const result = UpdatesService.queueFleetAppUpgrade(
      appName,
      packageIdentifier,
      availableVersion,
      deviceIds,
      req.user!.userId,
      req.user!.username,
      expiresAt || null
    );

    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger update check across all monitored devices
 */
updatesRouter.post('/check-all', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = UpdatesService.checkUpdatesAllDevices(req.user!.userId, req.user!.username);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger update check on single device
 */
updatesRouter.post('/check-device/:deviceId', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const jobId = UpdatesService.checkUpdatesSingleDevice(req.params.deviceId, req.user!.userId, req.user!.username);
    return res.json({ success: true, jobId });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   APP PINNING ENDPOINTS
   ========================================================================== */

/**
 * Get all app pins
 */
updatesRouter.get('/pins', updatesUserAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const pins = UpdatesService.getAppPins(req.user!.userId);
    return res.json(pins);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Set app pin (global or device-specific)
 */
updatesRouter.post('/pins', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { appName, pinType, pinnedVersion, deviceId, reason } = req.body;
    if (!appName || !pinType) {
      return res.status(400).json({ error: 'appName and pinType are required' });
    }

    const pin = UpdatesService.setAppPin(
      appName,
      pinType,
      pinnedVersion,
      deviceId,
      reason,
      req.user!.userId,
      req.user!.username
    );

    return res.json({ success: true, pin });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Delete app pin
 */
updatesRouter.delete('/pins/:id', updatesAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    UpdatesService.deleteAppPin(req.params.id, req.user!.userId, req.user!.username);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
