import { Router, Response } from 'express';
import { authenticateUser, requireTabAccess, requireAdmin, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { CloudService } from '../services/cloud.service.js';
import { db } from '../db/database.js';

export const cloudRouter = Router();

/* =========================================================================
   PUBLIC SHARE ROUTES (NO AUTHENTICATION REQUIRED)
   ========================================================================= */

/**
 * GET /api/cloud/public/share/:token
 * Retrieve public share details (metadata only, no auth required)
 */
cloudRouter.get('/public/share/:token', (req, res) => {
  try {
    const { token } = req.params;
    const share = CloudService.getPublicShare(token);
    if (!share) {
      return res.status(404).json({ error: 'Share link is invalid, expired, or has been revoked.' });
    }

    return res.json({
      token: share.token,
      filename: share.original_filename,
      fileSizeBytes: share.file_size_bytes,
      mimeType: share.mime_type,
      shareType: share.share_type,
      hasPin: share.has_pin,
      expiresAt: share.expires_at,
      createdAt: share.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to retrieve share' });
  }
});

/**
 * POST /api/cloud/public/share/:token/verify
 * Verify PIN for protected share
 */
cloudRouter.post('/public/share/:token/verify', (req, res) => {
  try {
    const { token } = req.params;
    const { pin } = req.body;
    const share = CloudService.getPublicShare(token);
    if (!share) {
      return res.status(404).json({ error: 'Share link is invalid or expired' });
    }

    const isValid = CloudService.verifySharePin(share, pin);
    if (!isValid) {
      return res.status(401).json({ valid: false, error: 'Incorrect PIN password' });
    }

    return res.json({ valid: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to verify PIN' });
  }
});

/**
 * GET /api/cloud/public/share/:token/download
 * Public direct stream download of shared file
 */
cloudRouter.get('/public/share/:token/download', (req, res) => {
  try {
    const { token } = req.params;
    const pin = typeof req.query.pin === 'string' ? req.query.pin : '';
    const share = CloudService.getPublicShare(token);
    if (!share) {
      return res.status(404).send('Share link is invalid, expired, or revoked.');
    }

    if (share.has_pin) {
      const isValid = CloudService.verifySharePin(share, pin);
      if (!isValid) {
        return res.status(401).send('PIN verification required to download this file.');
      }
    }

    CloudService.streamDownloadShare(share, res);
  } catch (err: any) {
    if (!res.headersSent) {
      return res.status(500).send(`Download failed: ${err.message}`);
    }
  }
});

/* =========================================================================
   AUTHENTICATED & TAB-PERMISSION GATED CLOUD ROUTES
   ========================================================================= */
cloudRouter.use(authenticateUser);
cloudRouter.use(requireTabAccess('cloud'));

/**
 * GET /api/cloud/files
 * Browse contents of user's personal drive folder
 */
cloudRouter.get('/files', (req: AuthenticatedRequest, res: Response) => {
  try {
    const username = req.user!.username;
    const subPath = typeof req.query.path === 'string' ? req.query.path : '';
    const items = CloudService.listDirectory(username, subPath);
    return res.json({ items, currentPath: subPath });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to list directory' });
  }
});

/**
 * GET /api/cloud/tree
 * Return recursive directory tree structure for sidebar navigation
 */
cloudRouter.get('/tree', (req: AuthenticatedRequest, res: Response) => {
  try {
    const username = req.user!.username;
    const tree = CloudService.getFolderTree(username);
    return res.json({ tree });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to get folder tree' });
  }
});

/**
 * GET /api/cloud/usage
 * Return user storage consumption stats
 */
cloudRouter.get('/usage', (req: AuthenticatedRequest, res: Response) => {
  try {
    const username = req.user!.username;
    const usage = CloudService.getUserStorageUsage(username);
    return res.json(usage);
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to get storage usage' });
  }
});

/**
 * POST /api/cloud/folder
 * Create new folder in user's personal drive
 */
cloudRouter.post('/folder', (req: AuthenticatedRequest, res: Response) => {
  try {
    const username = req.user!.username;
    const { path: folderPath, color } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path is required' });
    }
    CloudService.createFolder(username, folderPath, color);
    return res.json({ success: true, path: folderPath });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to create folder' });
  }
});

/**
 * PUT /api/cloud/folder/color
 * Update folder color coding
 */
cloudRouter.put('/folder/color', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { path: folderPath, color } = req.body;
    if (!folderPath || !color) {
      return res.status(400).json({ error: 'Folder path and color are required' });
    }
    CloudService.setFolderColor(userId, folderPath, color);
    return res.json({ success: true, path: folderPath, color });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to set folder color' });
  }
});

/**
 * POST /api/cloud/upload
 * Stream multipart upload directly to user's permanent drive (supports nested folder paths)
 */
cloudRouter.post('/upload', (req: AuthenticatedRequest, res: Response) => {
  const username = req.user!.username;
  const targetDir = typeof req.query.path === 'string' ? req.query.path : '';
  const relativePath = typeof req.query.relativePath === 'string' ? req.query.relativePath : undefined;

  CloudService.streamUploadPermanent(username, targetDir, req, relativePath)
    .then((file) => res.json({ success: true, file }))
    .catch((err) => res.status(500).json({ error: err.message || 'Upload failed' }));
});

/**
 * POST /api/cloud/quick-link/upload
 * Stream multipart upload directly to user's temp/ folder & generate Quick Link
 */
cloudRouter.post('/quick-link/upload', (req: AuthenticatedRequest, res: Response) => {
  const user = { id: req.user!.userId, username: req.user!.username };
  const expiresInSeconds = req.query.expiresInSeconds ? parseInt(req.query.expiresInSeconds as string, 10) : null;
  const pin = typeof req.query.pin === 'string' ? req.query.pin : undefined;

  CloudService.streamUploadQuickLink(user, req, { expiresInSeconds, pinPlaintext: pin })
    .then((result) => res.json({ success: true, ...result }))
    .catch((err) => res.status(500).json({ error: err.message || 'Quick link upload failed' }));
});

/**
 * PUT /api/cloud/rename
 * Rename and/or color-code file or folder in user's permanent drive
 */
cloudRouter.put('/rename', (req: AuthenticatedRequest, res: Response) => {
  try {
    const username = req.user!.username;
    const { path: oldPath, newName, color } = req.body;
    if (!oldPath || !newName) {
      return res.status(400).json({ error: 'Path and newName are required' });
    }
    CloudService.renameItem(username, oldPath, newName, color);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to rename item' });
  }
});

/**
 * PUT /api/cloud/move
 * Move file or folder to a target directory in user's permanent drive
 */
cloudRouter.put('/move', (req: AuthenticatedRequest, res: Response) => {
  try {
    const username = req.user!.username;
    const { src, dest } = req.body;
    if (src === undefined || dest === undefined) {
      return res.status(400).json({ error: 'Source and destination paths are required' });
    }
    CloudService.moveItem(username, src, dest);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to move item' });
  }
});

/**
 * DELETE /api/cloud/item
 * Delete file or folder from user's permanent drive
 */
cloudRouter.delete('/item', (req: AuthenticatedRequest, res: Response) => {
  try {
    const username = req.user!.username;
    const { path: itemPath } = req.body;
    if (!itemPath) {
      return res.status(400).json({ error: 'Item path is required' });
    }
    CloudService.deleteItem(username, itemPath);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to delete item' });
  }
});

/**
 * GET /api/cloud/download
 * Download file from user's own permanent drive
 */
cloudRouter.get('/download', (req: AuthenticatedRequest, res: Response) => {
  try {
    const username = req.user!.username;
    const virtualPath = typeof req.query.path === 'string' ? req.query.path : '';
    const inline = req.query.inline === 'true';
    if (!virtualPath) {
      return res.status(400).send('Path is required');
    }
    CloudService.streamDownloadUserFile(username, virtualPath, res, inline);
  } catch (err: any) {
    if (!res.headersSent) {
      return res.status(500).send(`Download failed: ${err.message}`);
    }
  }
});

/**
 * POST /api/cloud/shares
 * Generate share link for a permanent file
 */
cloudRouter.post('/shares', (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = { id: req.user!.userId, username: req.user!.username };
    const { path: virtualPath, pin, expiresInSeconds } = req.body;
    if (!virtualPath) {
      return res.status(400).json({ error: 'File path is required' });
    }

    const share = CloudService.createPermanentShare(user, virtualPath, {
      pinPlaintext: pin,
      expiresInSeconds: expiresInSeconds ? parseInt(expiresInSeconds, 10) : null,
    });

    return res.json({ success: true, ...share });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to create share link' });
  }
});

/**
 * GET /api/cloud/shares
 * List active shares created by current user
 */
cloudRouter.get('/shares', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const shares = CloudService.getSharesByUser(userId);
    return res.json({ shares });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to list shares' });
  }
});

/**
 * DELETE /api/cloud/shares/:id
 * Revoke a share link (deletes temp file on disk if quick_link, preserves file if permanent)
 */
cloudRouter.delete('/shares/:id', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';
    const { id } = req.params;
    CloudService.revokeShare(id, userId, isAdmin);
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to revoke share link' });
  }
});

/**
 * GET /api/cloud/audit
 * View Quick Link activity audit log history
 */
cloudRouter.get('/audit', (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const isAdmin = req.user!.role === 'admin';
    const logs = CloudService.getAuditLogs(userId, isAdmin);
    return res.json({ logs });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to get audit logs' });
  }
});

/**
 * GET /api/cloud/settings
 * Read current storage base path
 */
cloudRouter.get('/settings', (_req: AuthenticatedRequest, res: Response) => {
  try {
    const basePath = CloudService.getBasePath();
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'cloud_storage_base_path'").get() as { value?: string } | undefined;
    return res.json({ basePath, configuredPath: row?.value || '' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to load cloud settings' });
  }
});

/**
 * PUT /api/cloud/settings
 * Admin: Update cloud storage base path
 */
cloudRouter.put('/settings', requireAdmin, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { basePath } = req.body;
    db.prepare("UPDATE system_settings SET value = ? WHERE key = 'cloud_storage_base_path'").run(basePath || '');
    return res.json({ success: true, basePath: CloudService.getBasePath() });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Failed to update cloud settings' });
  }
});
