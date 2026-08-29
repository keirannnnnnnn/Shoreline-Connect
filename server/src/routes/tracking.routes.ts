import { Router, Request, Response } from 'express';
import { TrackingService } from '../services/tracking.service.js';
import { authenticateUser, requireTabAccess, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { db } from '../db/database.js';

export const trackingRouter = Router();

trackingRouter.post('/report', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid tracking item bearer token' });
  }

  const rawToken = authHeader.substring(7).trim();
  const item = TrackingService.authenticateToken(rawToken);
  if (!item) {
    return res.status(401).json({ error: 'Unauthorized: Invalid tracking bearer token' });
  }

  try {
    const result = await TrackingService.recordLocation(item, req.body);
    return res.status(200).json({ status: 'ok', ...result });
  } catch (err: any) {
    return res.status(400).json({ error: err.message || 'Failed to record location' });
  }
});

const tabAuth = [authenticateUser, requireTabAccess('tracking')];

trackingRouter.get('/items', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const items = TrackingService.getUserItems(req.user!.userId);
    return res.json({ items });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

trackingRouter.post('/items', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, category, movement_threshold_meters, min_speed_kmh, stationary_dwell_seconds } = req.body;
    if (!name || !category) {
      return res.status(400).json({ error: 'Name and category are required' });
    }
    if (category !== 'Vehicles' && category !== 'Devices') {
      return res.status(400).json({ error: 'Category must be either "Vehicles" or "Devices"' });
    }

    const { item, rawToken } = TrackingService.createItem(req.user!.userId, {
      name,
      category,
      movement_threshold_meters: movement_threshold_meters ? Number(movement_threshold_meters) : undefined,
      min_speed_kmh: min_speed_kmh ? Number(min_speed_kmh) : undefined,
      stationary_dwell_seconds: stationary_dwell_seconds ? Number(stationary_dwell_seconds) : undefined,
    });

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const ingestUrl = protocol + '://' + host + '/api/tracking/report';

    return res.status(201).json({
      item,
      rawToken,
      ingestUrl,
      sampleCurl: `curl -X POST ${ingestUrl} -H "Authorization: Bearer ${rawToken}" -H "Content-Type: application/json" -d "{\\"latitude\\": 51.5074, \\"longitude\\": -0.1278, \\"speed\\": 45.0, \\"heading\\": 180, \\"battery_level\\": 92}"`
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

trackingRouter.get('/items/:id', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const item = TrackingService.getItem(req.params.id, req.user!.userId);
    if (!item) return res.status(404).json({ error: 'Tracked item not found' });
    return res.json({ item });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

trackingRouter.put('/items/:id', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const updated = TrackingService.updateItem(req.params.id, req.user!.userId, req.body);
    if (!updated) return res.status(404).json({ error: 'Tracked item not found' });
    return res.json({ item: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

trackingRouter.delete('/items/:id', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const success = TrackingService.deleteItem(req.params.id, req.user!.userId);
    if (!success) return res.status(404).json({ error: 'Tracked item not found' });
    return res.json({ success: true, message: 'Tracked item and location history deleted' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

trackingRouter.post('/items/:id/regenerate-token', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = TrackingService.regenerateToken(req.params.id, req.user!.userId);
    if (!result) return res.status(404).json({ error: 'Tracked item not found' });
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

trackingRouter.get('/items/:id/journeys', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const journeys = TrackingService.getItemJourneys(req.params.id, req.user!.userId);
    return res.json({ journeys });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

trackingRouter.get('/journeys/:id/points', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const points = TrackingService.getJourneyPoints(req.params.id, req.user!.userId);
    return res.json({ points });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

trackingRouter.get('/settings', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const mapProviderRow = db.prepare("SELECT value FROM system_settings WHERE key = 'tracking_map_provider'").get() as { value: string } | undefined;
    const gmapsKeyRow = db.prepare("SELECT value FROM system_settings WHERE key = 'google_maps_api_key'").get() as { value: string } | undefined;

    return res.json({
      mapProvider: mapProviderRow?.value || 'leaflet',
      googleMapsApiKey: gmapsKeyRow?.value || '',
      hasGoogleMapsKey: Boolean(gmapsKeyRow?.value && gmapsKeyRow.value.trim().length > 0)
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

trackingRouter.put('/settings', tabAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const { mapProvider, googleMapsApiKey } = req.body;
    const upsert = db.prepare('INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');

    if (mapProvider && (mapProvider === 'leaflet' || mapProvider === 'google')) {
      upsert.run('tracking_map_provider', mapProvider);
    }
    if (googleMapsApiKey !== undefined) {
      upsert.run('google_maps_api_key', String(googleMapsApiKey).trim());
    }

    return res.json({ success: true, message: 'Tracking settings saved successfully' });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
