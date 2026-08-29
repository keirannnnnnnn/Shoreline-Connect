import { Router, Response } from 'express';
import { authenticateUser, requireTabAccess, AuthenticatedRequest } from '../middleware/auth.middleware.js';

export const trackingRouter = Router();

// Gated by authentication and the Tracking tab AD group permission
trackingRouter.use(authenticateUser);
trackingRouter.use(requireTabAccess('tracking'));

/**
 * GET /api/tracking/status
 * Scaffolded status endpoint for Tracking subsystem
 */
trackingRouter.get('/status', (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    enabled: true,
    feature: 'tracking',
    scaffold: true,
    version: '1.0.0-scaffold',
    message: 'Shoreline Tracking API scaffold initialized. Ready for Build 2.',
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/tracking/devices
 * Placeholder for tracked devices
 */
trackingRouter.get('/devices', (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    devices: [],
    message: 'Tracking subsystem scaffolded. No tracked devices registered yet.',
  });
});
