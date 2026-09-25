import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
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
 * Agent download endpoint (for installer binaries or agent update binaries)
 */
updatesRouter.get('/agent/download/:fileId', authenticateAgent, (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId;
    
    // Check if it's an agent binary request
    if (fileId.startsWith('shoreline-agent-')) {
      const candidatePaths = [
        path.resolve(__dirname, '../../agents', fileId),
        path.resolve(__dirname, '../../../agents', fileId),
        path.resolve(__dirname, '../../../agent/dist', fileId),
      ];

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          return res.sendFile(p);
        }
      }
      return res.status(404).json({ error: 'Agent binary not found' });
    }

    return res.status(404).json({ error: 'File not found' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/* ==========================================================================
   USER & ADMIN UI API ENDPOINTS (Session / Tab Access Auth)
   ========================================================================== */

const tabAuth = [authenticateUser, requireTabAccess('updates')];
const tabAdminAuth = [authenticateUser, requireTabAdmin('updates')];

/**
 * Get Overview KPI metrics
 */
updatesRouter.get('/overview', tabAuth, (req: AuthenticatedRequest, res: Response) => {
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
updatesRouter.get('/inventory', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const inventory = UpdatesService.getFleetInventory(req.user!.userId, search);
    return res.json({ inventory });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Get device specific software inventory and history diffs
 */
updatesRouter.get('/inventory/device/:deviceId', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = UpdatesService.getDeviceInventory(req.params.deviceId, req.user!.userId);
    return res.json(data);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger on-demand inventory rescan job
 */
updatesRouter.post('/inventory/rescan/:deviceId', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const jobId = UpdatesService.queueJob(
      req.params.deviceId,
      'inventory_scan',
      {},
      req.user!.userId,
      req.user!.username
    );
    return res.json({ success: true, jobId });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Get jobs list
 */
updatesRouter.get('/jobs', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 100;
    const jobs = UpdatesService.getJobs(req.user!.userId, limit);
    return res.json({ jobs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Cancel queued job
 */
updatesRouter.post('/jobs/:id/cancel', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    UpdatesService.cancelJob(
      req.params.id,
      req.user!.userId,
      req.user!.username,
      req.user!.role === 'admin'
    );
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * Get audit logs
 */
updatesRouter.get('/audit', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 200;
    const logs = UpdatesService.getAuditLogs(req.user!.userId, limit);
    return res.json({ logs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Trigger agent self-update job (Admin only)
 */
updatesRouter.post('/agent/self-update/:deviceId', tabAdminAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { targetVersion, downloadFile } = req.body;
    const jobId = UpdatesService.queueJob(
      req.params.deviceId,
      'agent_update',
      { targetVersion, downloadFile },
      req.user!.userId,
      req.user!.username,
      600 // 10 min timeout for self-update
    );
    return res.json({ success: true, jobId });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});
