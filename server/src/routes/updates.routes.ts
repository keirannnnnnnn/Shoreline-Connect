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
