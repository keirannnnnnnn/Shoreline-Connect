import { Router } from 'express';
import { authenticateUser, requireAdmin, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { db } from '../db/database.js';
import { AuthService } from '../services/auth.service.js';
import { DeviceService } from '../services/device.service.js';
import { AuditService } from '../services/audit.service.js';
import { UpdateService } from '../services/update.service.js';

const router = Router();

// Apply auth and admin check to all admin routes
router.use(authenticateUser);
router.use(requireAdmin);

/**
 * GET /api/admin/settings
 */
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT key, value, updated_at FROM system_settings').all() as { key: string; value: string; updated_at: string }[];
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json({ settings });
});

/**
 * PUT /api/admin/settings
 */
router.put('/settings', (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== 'object') {
    return res.status(400).json({ error: 'Settings object is required' });
  }

  const upsert = db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value === 'string') {
      upsert.run(key, value);
    }
  }

  res.json({ success: true, message: 'Settings updated successfully' });
});

/**
 * GET /api/admin/users
 */
router.get('/users', (req, res) => {
  const users = AuthService.getAllUsers();
  res.json({ users });
});

/**
 * GET /api/admin/users/:id/devices
 * Multi-user isolation guarantee: Returns devices created by admin on behalf of this target user
 */
router.get('/users/:id/devices', (req, res) => {
  const targetUserId = req.params.id;
  const devices = DeviceService.getAdminCreatedDevicesForUser(targetUserId);
  res.json({ devices });
});

/**
 * GET /api/admin/sessions
 * Session audit logs
 */
router.get('/sessions', (req, res) => {
  const { userId, deviceId, connectionMethod, status, search, limit, offset } = req.query;

  const result = AuditService.getSessionLogs({
    userId: userId ? String(userId) : undefined,
    deviceId: deviceId ? String(deviceId) : undefined,
    connectionMethod: connectionMethod ? String(connectionMethod) : undefined,
    status: status ? String(status) : undefined,
    search: search ? String(search) : undefined,
    limit: limit ? parseInt(String(limit), 10) : 50,
    offset: offset ? parseInt(String(offset), 10) : 0,
  });

  res.json(result);
});

/**
 * GET /api/admin/update/status
 */
router.get('/update/status', async (req, res) => {
  const status = await UpdateService.getStatus();
  res.json({ status });
});

/**
 * POST /api/admin/update/check
 */
router.post('/update/check', async (req, res) => {
  const check = await UpdateService.checkForUpdates();
  res.json(check);
});

/**
 * POST /api/admin/update/apply
 */
router.post('/update/apply', async (req, res) => {
  const { repoUrl, branch } = req.body;
  const result = await UpdateService.performUpdate(repoUrl, branch);
  res.json(result);
});

export default router;
