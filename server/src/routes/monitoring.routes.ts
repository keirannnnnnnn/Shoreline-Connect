import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { db } from '../db/database.js';
import { MonitoringService } from '../services/monitoring.service.js';
import { UpdatesService } from '../services/updates.service.js';
import { authenticateUser, requireTabAccess, AuthenticatedRequest } from '../middleware/auth.middleware.js';

export const monitoringRouter = Router();

const tabAuth = [authenticateUser, requireTabAccess('monitoring')];

/**
 * 1. Agent Ingest Endpoint (Authenticated by per-device Bearer token)
 */
monitoringRouter.post('/report', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid agent bearer token' });
  }

  const rawToken = authHeader.substring(7).trim();
  const authResult = MonitoringService.authenticateAgentToken(rawToken);
  if (!authResult) {
    return res.status(401).json({ error: 'Unauthorized: Invalid device agent token' });
  }

  try {
    const result = MonitoringService.recordMetrics(authResult.deviceId, req.body);
    return res.status(200).json({ status: 'ok', next_job: result.next_job });
  } catch (err: any) {
    console.error('[Monitoring Ingest Error]:', err.message);
    return res.status(500).json({ error: 'Failed to record metrics' });
  }
});

/**
 * 2. Dynamic Linux Bash Install Script Endpoint
 */
monitoringRouter.get('/install.sh', (req: Request, res: Response) => {
  const token = (req.query.token as string) || '';
  if (!token) {
    return res.status(400).send('echo "❌ Error: Missing token parameter in install command"; exit 1;');
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const reqHostUrl = `${protocol}://${host}`;
  const hostUrl = MonitoringService.getEffectiveHubUrl(reqHostUrl);

  const script = MonitoringService.generateLinuxInstallScript(hostUrl, token);
  res.setHeader('Content-Type', 'text/x-shellscript');
  return res.send(script);
});

/**
 * 3. Dynamic Windows PowerShell Install Script Endpoint
 */
monitoringRouter.get('/install.ps1', (req: Request, res: Response) => {
  const token = (req.query.token as string) || '';
  if (!token) {
    return res.status(400).send('Write-Host "❌ Error: Missing token parameter in install command" -ForegroundColor Red; exit 1;');
  }

  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const reqHostUrl = `${protocol}://${host}`;
  const hostUrl = MonitoringService.getEffectiveHubUrl(reqHostUrl);

  const script = MonitoringService.generateWindowsInstallScript(hostUrl, token);
  res.setHeader('Content-Type', 'text/plain');
  return res.send(script);
});

/**
 * 4. Precompiled Agent Binary Download Endpoint
 */
monitoringRouter.get('/agent/download/:os/:arch', (req: Request, res: Response) => {
  const { os, arch } = req.params;

  let filename = '';
  let targetArch = 'amd64';
  if (os === 'linux') {
    if (arch === 'arm64' || arch === 'aarch64' || arch === 'armv7l') {
      filename = 'shoreline-agent-linux-arm64';
      targetArch = 'arm64';
    } else {
      filename = 'shoreline-agent-linux-amd64';
      targetArch = 'amd64';
    }
  } else if (os === 'windows') {
    filename = 'shoreline-agent-windows-amd64.exe';
    targetArch = 'amd64';
  } else {
    return res.status(400).json({ error: 'Unsupported operating system' });
  }

  // 1. Check if there is an explicit install default build in database
  try {
    const defaultBuild = db.prepare(`
      SELECT file_path FROM update_agent_builds
      WHERE target_os = ? AND target_arch = ? AND is_install_default = 1
    `).get(os, targetArch) as { file_path: string } | undefined;

    if (defaultBuild && fs.existsSync(defaultBuild.file_path)) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.sendFile(defaultBuild.file_path);
    }
  } catch {}

  // Check multiple candidate locations (Docker /app/server/agents, local agent/dist, or server/agents)
  const candidatePaths = [
    path.resolve(UpdatesService.getAgentBinariesDir(), filename),
    path.resolve(__dirname, '../../agents', filename),
    path.resolve(__dirname, '../../../agents', filename),
    path.resolve(__dirname, '../../../agent/dist', filename),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.sendFile(p);
    }
  }

  return res.status(404).json({ error: `Agent binary not found: ${filename}. Please run agent build.` });
});

/**
 * 5. UI API: List Monitored Devices for current user
 */
monitoringRouter.get('/devices', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const devices = MonitoringService.getUserMonitoredDevices(req.user!.userId);
    return res.json({ devices });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 6. UI API: Get Agent Status / Install info for a specific device
 */
monitoringRouter.get('/devices/:id', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const hostUrl = `${protocol}://${host}`;

    const info = MonitoringService.getAgentStatus(req.params.id, req.user!.userId, hostUrl);
    return res.json({ info });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 7. UI API: Enable Monitoring for a device
 */
monitoringRouter.post('/devices/:id/enable', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const hostUrl = `${protocol}://${host}`;

    const result = MonitoringService.enableMonitoring(req.params.id, req.user!.userId, hostUrl);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 8. UI API: Regenerate token for a device
 */
monitoringRouter.post('/devices/:id/regenerate-token', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const hostUrl = `${protocol}://${host}`;

    const result = MonitoringService.regenerateToken(req.params.id, req.user!.userId, hostUrl);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 9. UI API: Disable Monitoring for a device
 */
monitoringRouter.post('/devices/:id/disable', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    MonitoringService.disableMonitoring(req.params.id, req.user!.userId);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 10. UI API: Query Time-Series Metrics for charts
 */
monitoringRouter.get('/devices/:id/metrics', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const range = (req.query.range as any) || '1h';
    const metrics = MonitoringService.getDeviceMetrics(req.params.id, req.user!.userId, range);
    return res.json(metrics);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
