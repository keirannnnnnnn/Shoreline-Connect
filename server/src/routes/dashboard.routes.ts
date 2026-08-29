import { Router, Response } from 'express';
import { db } from '../db/database.js';
import { AuthService } from '../services/auth.service.js';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth.middleware.js';

export const dashboardRouter = Router();

dashboardRouter.use(authenticateUser);

export interface WidgetCatalogItem {
  id: string;
  type: string;
  title: string;
  description: string;
  category: 'monitoring' | 'devices' | 'system' | 'shortcuts';
  requiredTab?: string;
  icon: string;
  defaultSize: { w: number; h: number };
}

export const WIDGET_CATALOG: WidgetCatalogItem[] = [
  {
    id: 'fleet-health',
    type: 'fleet-health',
    title: 'Fleet Health & Metrics Overview',
    description: 'Summarizes online/offline status, agent health, and devices with high CPU/RAM/Disk consumption at a glance.',
    category: 'monitoring',
    requiredTab: 'monitoring',
    icon: 'waveform.path.ecg',
    defaultSize: { w: 12, h: 4 },
  },
  {
    id: 'quick-connect',
    type: 'quick-connect',
    title: 'Quick Launch & Recent Connections',
    description: 'Direct shortcuts to your most recently accessed RDP and SSH sessions.',
    category: 'devices',
    requiredTab: 'devices',
    icon: 'macbook.and.iphone',
    defaultSize: { w: 6, h: 4 },
  },
  {
    id: 'system-status',
    type: 'system-status',
    title: 'Shoreline Connect Status',
    description: 'Displays server version, Active Directory connection state, and active sessions.',
    category: 'system',
    icon: 'server.rack',
    defaultSize: { w: 6, h: 4 },
  }
];

const DEFAULT_LAYOUT = [
  {
    instanceId: 'w-fleet-health-default',
    type: 'fleet-health',
    title: 'Fleet Health Overview',
    w: 12,
    order: 0,
    enabled: true,
  },
  {
    instanceId: 'w-quick-connect-default',
    type: 'quick-connect',
    title: 'Quick Launch',
    w: 6,
    order: 1,
    enabled: true,
  },
  {
    instanceId: 'w-system-status-default',
    type: 'system-status',
    title: 'System Information',
    w: 6,
    order: 2,
    enabled: true,
  },
];

/**
 * GET /api/dashboard/layout
 * Get authenticated user dashboard layout
 */
dashboardRouter.get('/layout', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const row = db.prepare('SELECT layout_json FROM user_dashboard_layouts WHERE user_id = ?').get(userId) as { layout_json: string } | undefined;

  let layout = DEFAULT_LAYOUT;
  if (row?.layout_json) {
    try {
      layout = JSON.parse(row.layout_json);
    } catch {}
  }

  return res.json({ layout });
});

/**
 * POST /api/dashboard/layout
 * Save authenticated user dashboard layout
 */
dashboardRouter.post('/layout', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const { layout } = req.body;

  if (!Array.isArray(layout)) {
    return res.status(400).json({ error: 'Layout must be an array of widget configurations' });
  }

  const layoutJson = JSON.stringify(layout);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO user_dashboard_layouts (user_id, layout_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json, updated_at = excluded.updated_at
  `).run(userId, layoutJson, now);

  return res.json({ success: true, message: 'Dashboard layout saved successfully' });
});

/**
 * GET /api/dashboard/widgets
 * Return available widget catalog filtered by user tab permissions
 */
dashboardRouter.get('/widgets', (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user!.userId;
  const permissions = AuthService.getUserPermissions(userId);

  const availableWidgets = WIDGET_CATALOG.filter(w => {
    if (!w.requiredTab) return true;
    return permissions.tabs[w.requiredTab]?.canAccess;
  });

  return res.json({ widgets: availableWidgets });
});
