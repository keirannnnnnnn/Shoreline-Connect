import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { MonitoringService } from '../services/monitoring.service.js';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth.middleware.js';

export const monitoringRouter = Router();

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
    MonitoringService.recordMetrics(authResult.deviceId, req.body);
    return res.status(200).json({ status: 'ok' });
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
  const hostUrl = `${protocol}://${host}`;

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
  const hostUrl = `${protocol}://${host}`;

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
  if (os === 'linux') {
    if (arch === 'arm64' || arch === 'aarch64' || arch === 'armv7l') {
      filename = 'shoreline-agent-linux-arm64';
    } else {
      filename = 'shoreline-agent-linux-amd64';
    }
  } else if (os === 'windows') {
    filename = 'shoreline-agent-windows-amd64.exe';
  } else {
    return res.status(400).json({ error: 'Unsupported operating system' });
  }

  // Check multiple candidate locations (Docker /app/server/agents, local agent/dist, or server/agents)
  const candidatePaths = [
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
monitoringRouter.get('/devices', authenticateUser, (req: AuthenticatedRequest, res: Response) => {
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
monitoringRouter.get('/devices/:id', authenticateUser, (req: AuthenticatedRequest, res: Response) => {
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
monitoringRouter.post('/devices/:id/enable', authenticateUser, (req: AuthenticatedRequest, res: Response) => {
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
monitoringRouter.post('/devices/:id/regenerate-token', authenticateUser, (req: AuthenticatedRequest, res: Response) => {
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
monitoringRouter.post('/devices/:id/disable', authenticateUser, (req: AuthenticatedRequest, res: Response) => {
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
monitoringRouter.get('/devices/:id/metrics', authenticateUser, (req: AuthenticatedRequest, res: Response) => {
  try {
    const range = (req.query.range as any) || '1h';
    const metrics = MonitoringService.getDeviceMetrics(req.params.id, req.user!.userId, range);
    return res.json(metrics);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
