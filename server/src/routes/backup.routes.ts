import { Router, Response } from 'express';
import { db } from '../db/database.js';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth.middleware.js';

export const backupRouter = Router();

backupRouter.use(authenticateUser);

/**
 * GET /api/backup/export
 * Download complete JSON backup of user data (or full system if admin)
 */
backupRouter.get('/export', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';

  let devices: any[] = [];
  let folders: any[] = [];
  let guestShares: any[] = [];
  let dashboardLayout: any = null;
  let systemSettings: any[] = [];

  if (isAdmin) {
    devices = db.prepare('SELECT * FROM devices').all();
    folders = db.prepare('SELECT * FROM folders').all();
    guestShares = db.prepare('SELECT * FROM guest_shares').all();
    systemSettings = db.prepare('SELECT * FROM system_settings').all();
  } else {
    devices = db.prepare('SELECT * FROM devices WHERE owner_id = ?').all(userId);
    folders = db.prepare('SELECT * FROM folders WHERE user_id = ?').all(userId);
    guestShares = db.prepare('SELECT * FROM guest_shares WHERE created_by_user_id = ?').all(userId);
  }

  const layoutRow = db.prepare('SELECT layout_json FROM user_dashboard_layouts WHERE user_id = ?').get(userId) as { layout_json: string } | undefined;
  if (layoutRow?.layout_json) {
    try {
      dashboardLayout = JSON.parse(layoutRow.layout_json);
    } catch {}
  }

  const backupPayload = {
    schemaVersion: '1.0.0',
    app: 'Shoreline Connect',
    exportedAt: new Date().toISOString(),
    exportedBy: {
      userId,
      username: req.user!.username,
      displayName: req.user!.displayName,
      role: req.user!.role,
    },
    data: {
      folders,
      devices,
      guestShares,
      dashboardLayout,
      systemSettings: isAdmin ? systemSettings : undefined,
    },
  };

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `shoreline-backup-${timestamp}.json`;

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(JSON.stringify(backupPayload, null, 2));
});

/**
 * POST /api/backup/import
 * Restore backup JSON payload into SQLite database
 */
backupRouter.post('/import', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const isAdmin = req.user!.role === 'admin';
  const backup = req.body;

  if (!backup || !backup.data) {
    return res.status(400).json({ error: 'Invalid backup file format. Missing "data" payload.' });
  }

  const { folders = [], devices = [], guestShares = [], dashboardLayout, systemSettings = [] } = backup.data;

  let restoredFoldersCount = 0;
  let restoredDevicesCount = 0;
  let restoredSettingsCount = 0;

  try {
    db.exec('BEGIN TRANSACTION');

    // 1. Import Folders
    const insertFolder = db.prepare(`
      INSERT OR REPLACE INTO folders (id, name, user_id, icon, color, created_at)
      VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))
    `);

    for (const f of folders) {
      const targetUserId = isAdmin ? (f.user_id || userId) : userId;
      insertFolder.run(f.id, f.name, targetUserId, f.icon || 'folder.fill', f.color || '#3b82f6', f.created_at);
      restoredFoldersCount++;
    }

    // 2. Import Devices
    const insertDevice = db.prepare(`
      INSERT OR REPLACE INTO devices (
        id, name, protocol, host, port, encrypted_credentials,
        parameters, folder_id, is_favorite, owner_id, created_by_admin_id,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP
      )
    `);

    for (const d of devices) {
      const targetOwnerId = isAdmin ? (d.owner_id || userId) : userId;
      const targetCreatedByAdminId = isAdmin ? (d.created_by_admin_id || null) : null;

      insertDevice.run(
        d.id,
        d.name,
        d.protocol || 'rdp',
        d.host,
        d.port || (d.protocol === 'ssh' ? 22 : 3389),
        d.encrypted_credentials || '{}',
        typeof d.parameters === 'object' ? JSON.stringify(d.parameters) : (d.parameters || '{}'),
        d.folder_id || null,
        d.is_favorite ? 1 : 0,
        targetOwnerId,
        targetCreatedByAdminId,
        d.created_at
      );
      restoredDevicesCount++;
    }

    // 3. Import Dashboard Layout
    if (dashboardLayout && Array.isArray(dashboardLayout)) {
      const layoutJson = JSON.stringify(dashboardLayout);
      db.prepare(`
        INSERT INTO user_dashboard_layouts (user_id, layout_json, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = CURRENT_TIMESTAMP
      `).run(userId, layoutJson);
    }

    // 4. Import System Settings (Admin only)
    if (isAdmin && Array.isArray(systemSettings) && systemSettings.length > 0) {
      const insertSetting = db.prepare(`
        INSERT OR REPLACE INTO system_settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
      `);
      for (const s of systemSettings) {
        if (s.key && s.value !== undefined) {
          insertSetting.run(s.key, s.value);
          restoredSettingsCount++;
        }
      }
    }

    db.exec('COMMIT');

    return res.json({
      success: true,
      message: 'Backup data successfully restored!',
      summary: {
        devicesRestored: restoredDevicesCount,
        foldersRestored: restoredFoldersCount,
        settingsRestored: restoredSettingsCount,
        dashboardLayoutRestored: !!dashboardLayout,
      },
    });
  } catch (err: any) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error('[Backup Import Error]:', err);
    return res.status(500).json({ error: `Failed to restore backup: ${err.message}` });
  }
});
