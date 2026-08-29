import { Router, Response } from 'express';
import { authenticateUser, requireTabAccess, AuthenticatedRequest } from '../middleware/auth.middleware.js';

export const cloudRouter = Router();

// Gated by authentication and the Cloud tab AD group permission
cloudRouter.use(authenticateUser);
cloudRouter.use(requireTabAccess('cloud'));

/**
 * GET /api/cloud/status
 * Scaffolded status endpoint for Cloud Storage subsystem
 */
cloudRouter.get('/status', (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    enabled: true,
    feature: 'cloud',
    scaffold: true,
    version: '1.0.0-scaffold',
    message: 'Shoreline Cloud API scaffold initialized. Ready for Build 2.',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/cloud/files
 * Placeholder for cloud file vault
 */
cloudRouter.get('/files', (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    files: [],
    storageUsedBytes: 0,
    storageQuotaBytes: 10737418240, // 10 GB
    message: 'Cloud subsystem scaffolded. No files stored yet.',
  });
});
