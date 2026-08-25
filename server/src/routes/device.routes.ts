import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { DeviceService } from '../services/device.service.js';
import { AuditService } from '../services/audit.service.js';
import { config } from '../config/env.js';

const router = Router();

// Apply auth to all device routes
router.use(authenticateUser);

/**
 * GET /api/devices
 * Strictly returns only devices visible to the current user (Isolation Guaranteed)
 */
router.get('/', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const devices = DeviceService.getUserDevices(userId);
  res.json({ devices });
});

/**
 * GET /api/devices/recents
 * Top 5 recent connections
 */
router.get('/recents', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const recents = AuditService.getUserRecentConnections(userId, 5);
  res.json({ recents });
});

/**
 * POST /api/devices
 * Create a new device. Admins can pass target ownerId to create on behalf of another user.
 */
router.post('/', (req: AuthenticatedRequest, res) => {
  try {
    const currentUserId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';

    const { name, protocol, host, port, credentials, parameters, folderId, isFavorite, targetUserId } = req.body;

    if (!name || !protocol || !host) {
      return res.status(400).json({ error: 'Name, protocol, and host are required' });
    }

    if (!['rdp', 'vnc', 'ssh'].includes(protocol)) {
      return res.status(400).json({ error: 'Protocol must be rdp, vnc, or ssh' });
    }

    let ownerId = currentUserId;
    let createdByAdminId: string | null = null;

    // Admin creating on behalf of another user
    if (isAdmin && targetUserId && targetUserId !== currentUserId) {
      ownerId = targetUserId;
      createdByAdminId = currentUserId;
    }

    const device = DeviceService.createDevice({
      name,
      protocol,
      host,
      port: port ? parseInt(port, 10) : undefined,
      credentials: credentials || {},
      parameters: parameters || {},
      folderId,
      isFavorite: !!isFavorite,
      ownerId,
      createdByAdminId,
    });

    res.status(201).json({ device });
  } catch (err: any) {
    console.error('[Create Device Error]', err.message);
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/devices/:id
 */
router.get('/:id', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';
  const result = DeviceService.getDeviceForUser(req.params.id, userId, isAdmin);

  if (!result) {
    return res.status(404).json({ error: 'Device not found or unauthorized' });
  }

  res.json(result);
});

/**
 * PUT /api/devices/:id
 */
router.put('/:id', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';
    const { name, protocol, host, port, credentials, parameters, folderId, isFavorite } = req.body;

    const device = DeviceService.updateDevice(req.params.id, userId, isAdmin, {
      name,
      protocol,
      host,
      port: port !== undefined ? parseInt(port, 10) : undefined,
      credentials,
      parameters,
      folderId,
      isFavorite,
    });

    res.json({ device });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/devices/:id
 */
router.delete('/:id', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';
    DeviceService.deleteDevice(req.params.id, userId, isAdmin);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/devices/:id/favorite
 */
router.post('/:id/favorite', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const isFavorite = DeviceService.toggleFavorite(req.params.id, userId);
    res.json({ isFavorite });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/devices/:id/connect-token
 * Issue short-lived signed tunnel token to authenticate WebSocket session
 */
router.post('/:id/connect-token', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';
  const deviceResult = DeviceService.getDeviceForUser(req.params.id, userId, isAdmin);

  if (!deviceResult) {
    return res.status(403).json({ error: 'Unauthorized to connect to this device' });
  }

  const isOwner = deviceResult.device.owner_id === userId;
  const connectionMethod = isOwner ? 'owner' : 'shared_user';

  const tunnelToken = jwt.sign({
    type: 'tunnel',
    deviceId: req.params.id,
    userId,
    connectionMethod,
    sessionId: `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
  }, config.jwtSecret, { expiresIn: '1m' });

  res.json({
    token: tunnelToken,
    device: {
      id: deviceResult.device.id,
      name: deviceResult.device.name,
      protocol: deviceResult.device.protocol,
    }
  });
});

/**
 * FOLDERS ROUTES
 */
router.get('/folders/all', (req: AuthenticatedRequest, res) => {
  const userId = req.user!.userId;
  const folders = DeviceService.getUserFolders(userId);
  res.json({ folders });
});

router.post('/folders/create', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    const { name, icon, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Folder name is required' });

    const folder = DeviceService.createFolder(userId, name, icon, color);
    res.status(201).json({ folder });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/folders/:id', (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user!.userId;
    DeviceService.deleteFolder(req.params.id, userId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
