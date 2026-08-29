import crypto from "crypto";
import { db } from "../db/database.js";

export interface TrackedItemRecord {
  id: string;
  name: string;
  category: "Vehicles" | "Devices";
  user_id: string;
  token_hash: string;
  movement_threshold_meters: number;
  min_speed_kmh: number;
  stationary_dwell_seconds: number;
  last_lat: number | null;
  last_lng: number | null;
  last_speed: number | null;
  last_heading: number | null;
  last_accuracy: number | null;
  last_battery: number | null;
  status: "moving" | "stationary" | "offline";
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IngestionLocationPayload {
  latitude: number;
  longitude: number;
  speed?: number;
  speed_unit?: "kmh" | "mph" | "ms";
  heading?: number;
  accuracy?: number;
  battery_level?: number;
  timestamp?: number | string;
}

export interface TrackingJourneyRecord {
  id: string;
  item_id: string;
  start_time: number;
  end_time: number | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  distance_km: number;
  duration_seconds: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  points_count: number;
  has_speeding: number;
  status: "in_progress" | "completed";
  created_at: string;
}

export interface JourneyPointRecord {
  id: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  battery_level: number | null;
  speed_limit: number | null;
  road_name: string | null;
  is_speeding: number;
  timestamp: number;
}

export class TrackingService {
  private static retentionInterval: NodeJS.Timeout | null = null;

  static haversineDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  static generateToken(): { rawToken: string; tokenHash: string } {
    const rawToken = "sh_trk_" + crypto.randomBytes(24).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    return { rawToken, tokenHash };
  }

  static authenticateToken(rawToken: string): TrackedItemRecord | null {
    if (!rawToken || !rawToken.startsWith("sh_trk_")) return null;
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const item = db.prepare("SELECT * FROM tracked_items WHERE token_hash = ?").get(tokenHash) as unknown as TrackedItemRecord | undefined;
    return item || null;
  }

  static createItem(
    userId: string,
    data: {
      name: string;
      category: "Vehicles" | "Devices";
      movement_threshold_meters?: number;
      min_speed_kmh?: number;
      stationary_dwell_seconds?: number;
    }
  ): { item: TrackedItemRecord; rawToken: string } {
    const id = crypto.randomUUID();
    const { rawToken, tokenHash } = this.generateToken();
    const movementThreshold = data.movement_threshold_meters ?? 25.0;
    const minSpeed = data.min_speed_kmh ?? 5.0;
    const stationaryDwell = data.stationary_dwell_seconds ?? 300;

    db.prepare(`
      INSERT INTO tracked_items (
        id, name, category, user_id, token_hash,
        movement_threshold_meters, min_speed_kmh, stationary_dwell_seconds,
        status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'offline', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(id, data.name, data.category, userId, tokenHash, movementThreshold, minSpeed, stationaryDwell);

    const item = db.prepare("SELECT * FROM tracked_items WHERE id = ?").get(id) as unknown as TrackedItemRecord;
    return { item, rawToken };
  }

  static getUserItems(userId: string): TrackedItemRecord[] {
    return (db.prepare("SELECT * FROM tracked_items WHERE user_id = ? ORDER BY created_at DESC").all(userId) as unknown) as TrackedItemRecord[];
  }

  static getItem(itemId: string, userId: string): TrackedItemRecord | undefined {
    return (db.prepare("SELECT * FROM tracked_items WHERE id = ? AND user_id = ?").get(itemId, userId) as unknown) as TrackedItemRecord | undefined;
  }

  static updateItem(
    itemId: string,
    userId: string,
    data: {
      name?: string;
      category?: "Vehicles" | "Devices";
      movement_threshold_meters?: number;
      min_speed_kmh?: number;
      stationary_dwell_seconds?: number;
    }
  ): TrackedItemRecord | null {
    const item = this.getItem(itemId, userId);
    if (!item) return null;

    const name = data.name ?? item.name;
    const category = data.category ?? item.category;
    const movementThreshold = data.movement_threshold_meters ?? item.movement_threshold_meters;
    const minSpeed = data.min_speed_kmh ?? item.min_speed_kmh;
    const stationaryDwell = data.stationary_dwell_seconds ?? item.stationary_dwell_seconds;

    db.prepare(`
      UPDATE tracked_items
      SET name = ?, category = ?, movement_threshold_meters = ?, min_speed_kmh = ?, stationary_dwell_seconds = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).run(name, category, movementThreshold, minSpeed, stationaryDwell, itemId, userId);

    return this.getItem(itemId, userId) || null;
  }

  static deleteItem(itemId: string, userId: string): boolean {
    const res = db.prepare("DELETE FROM tracked_items WHERE id = ? AND user_id = ?").run(itemId, userId);
    return res.changes > 0;
  }

  static regenerateToken(itemId: string, userId: string): { rawToken: string } | null {
    const item = this.getItem(itemId, userId);
    if (!item) return null;

    const { rawToken, tokenHash } = this.generateToken();
    db.prepare("UPDATE tracked_items SET token_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(tokenHash, itemId, userId);
    return { rawToken };
  }

  static async getSpeedLimit(lat: number, lng: number): Promise<{ speedLimitKmh: number | null; roadName: string | null }> {
    const latGrid = Math.round(lat * 1000) / 1000;
    const lngGrid = Math.round(lng * 1000) / 1000;

    const cached = db.prepare(`
      SELECT speed_limit_kmh, road_name FROM osm_speed_limits_cache
      WHERE lat_grid = ? AND lng_grid = ? LIMIT 1
    `).get(latGrid, lngGrid) as { speed_limit_kmh: number; road_name: string | null } | undefined;

    if (cached) {
      return { speedLimitKmh: cached.speed_limit_kmh > 0 ? cached.speed_limit_kmh : null, roadName: cached.road_name };
    }

    try {
      const overpassQuery = `[out:json][timeout:3];way(around:40,${lat},${lng})["maxspeed"];out tags 1;`;
      const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(overpassQuery)}`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3500);
      const res = await fetch(url, { headers: { "User-Agent": "ShorelineConnect/1.0" }, signal: controller.signal });
      clearTimeout(timeoutId);

      let parsedSpeedKmh: number | null = null;
      let roadName: string | null = null;

      if (res.ok) {
        const json: any = await res.json();
        const way = json.elements?.[0];
        const tags = way?.tags || {};
        roadName = tags.name || tags.ref || null;
        const rawMaxSpeed = (tags.maxspeed || "").toLowerCase().trim();

        if (rawMaxSpeed) {
          if (rawMaxSpeed.includes("mph")) {
            const num = parseFloat(rawMaxSpeed);
            if (!isNaN(num)) parsedSpeedKmh = Math.round(num * 1.60934);
          } else if (rawMaxSpeed === "national") {
            parsedSpeedKmh = 96;
          } else {
            const num = parseFloat(rawMaxSpeed);
            if (!isNaN(num)) parsedSpeedKmh = num;
          }
        }
      }

      const cacheId = crypto.randomUUID();
      db.prepare(`
        INSERT OR REPLACE INTO osm_speed_limits_cache (id, lat_grid, lng_grid, speed_limit_kmh, road_name, cached_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(cacheId, latGrid, lngGrid, parsedSpeedKmh || 0, roadName, Math.floor(Date.now() / 1000));

      return { speedLimitKmh: parsedSpeedKmh, roadName };
    } catch {
      const cacheId = crypto.randomUUID();
      db.prepare(`
        INSERT OR REPLACE INTO osm_speed_limits_cache (id, lat_grid, lng_grid, speed_limit_kmh, road_name, cached_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(cacheId, latGrid, lngGrid, 0, null, Math.floor(Date.now() / 1000));
      return { speedLimitKmh: null, roadName: null };
    }
  }

  static async recordLocation(item: TrackedItemRecord, payload: IngestionLocationPayload): Promise<{ success: boolean; journeyId?: string }> {
    const lat = Number(payload.latitude);
    const lng = Number(payload.longitude);
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("Invalid latitude or longitude coordinates");
    }

    let ts = Math.floor(Date.now() / 1000);
    if (payload.timestamp) {
      if (typeof payload.timestamp === "number") {
        ts = payload.timestamp > 1e11 ? Math.floor(payload.timestamp / 1000) : Math.floor(payload.timestamp);
      } else {
        const parsed = Date.parse(payload.timestamp);
        if (!isNaN(parsed)) ts = Math.floor(parsed / 1000);
      }
    }

    let distanceKm = 0;
    if (item.last_lat !== null && item.last_lng !== null) {
      distanceKm = this.haversineDistanceKm(item.last_lat, item.last_lng, lat, lng);
    }

    let speedKmh = payload.speed !== undefined && payload.speed !== null ? Number(payload.speed) : null;
    if (speedKmh !== null && !isNaN(speedKmh)) {
      if (payload.speed_unit === "mph") speedKmh = speedKmh * 1.60934;
      else if (payload.speed_unit === "ms") speedKmh = speedKmh * 3.6;
    } else if (distanceKm > 0 && item.last_seen_at) {
      const lastSeenTs = Math.floor(new Date(item.last_seen_at).getTime() / 1000);
      const timeDiffSec = Math.max(1, ts - lastSeenTs);
      speedKmh = (distanceKm / (timeDiffSec / 3600));
      if (speedKmh > 250) speedKmh = 0;
    }

    speedKmh = speedKmh !== null ? Math.round(speedKmh * 10) / 10 : 0;
    const distanceMeters = distanceKm * 1000;
    const isMoving = speedKmh >= item.min_speed_kmh || distanceMeters >= item.movement_threshold_meters;
    const newStatus: "moving" | "stationary" = isMoving ? "moving" : "stationary";

    const { speedLimitKmh, roadName } = await this.getSpeedLimit(lat, lng);
    const isSpeeding = speedLimitKmh && speedKmh && speedKmh > (speedLimitKmh + 3) ? 1 : 0;

    let activeJourney = db.prepare(`
      SELECT * FROM tracking_journeys WHERE item_id = ? AND status = 'in_progress' ORDER BY start_time DESC LIMIT 1
    `).get(item.id) as unknown as TrackingJourneyRecord | undefined;

    let journeyId: string | null = activeJourney?.id || null;
    if (isMoving) {
      if (!activeJourney) {
        journeyId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO tracking_journeys (
            id, item_id, start_time, start_lat, start_lng, end_lat, end_lng,
            distance_km, duration_seconds, avg_speed_kmh, max_speed_kmh, points_count, has_speeding, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, 1, ?, 'in_progress')
        `).run(journeyId, item.id, ts, lat, lng, lat, lng, speedKmh, speedKmh, isSpeeding);
      } else {
        const newDist = activeJourney.distance_km + distanceKm;
        const newDuration = Math.max(0, ts - activeJourney.start_time);
        const newMaxSpeed = Math.max(activeJourney.max_speed_kmh, speedKmh);
        const newPointsCount = activeJourney.points_count + 1;
        const newAvgSpeed = newDuration > 0 ? (newDist / (newDuration / 3600)) : speedKmh;
        const newHasSpeeding = activeJourney.has_speeding || isSpeeding;

        db.prepare(`
          UPDATE tracking_journeys
          SET end_time = ?, end_lat = ?, end_lng = ?, distance_km = ?,
              duration_seconds = ?, avg_speed_kmh = ?, max_speed_kmh = ?,
              points_count = ?, has_speeding = ?
          WHERE id = ?
        `).run(ts, lat, lng, newDist, newDuration, newAvgSpeed, newMaxSpeed, newPointsCount, newHasSpeeding, activeJourney.id);
      }
    } else {
      if (activeJourney) {
        const dwellTime = ts - (activeJourney.end_time || activeJourney.start_time);
        if (dwellTime >= item.stationary_dwell_seconds) {
          db.prepare(`
            UPDATE tracking_journeys SET status = 'completed', end_time = COALESCE(end_time, ?) WHERE id = ?
          `).run(ts, activeJourney.id);
          journeyId = null;
        }
      }
    }

    const pointId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO tracking_locations_raw (
        id, item_id, latitude, longitude, speed, heading, accuracy, battery_level,
        speed_limit, road_name, is_speeding, timestamp, journey_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(pointId, item.id, lat, lng, speedKmh, payload.heading ?? null, payload.accuracy ?? null, payload.battery_level ?? null, speedLimitKmh, roadName, isSpeeding, ts, journeyId);

    db.prepare(`
      UPDATE tracked_items
      SET last_lat = ?, last_lng = ?, last_speed = ?, last_heading = ?,
          last_accuracy = ?, last_battery = ?, status = ?, last_seen_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(lat, lng, speedKmh, payload.heading ?? item.last_heading, payload.accuracy ?? item.last_accuracy, payload.battery_level ?? item.last_battery, newStatus, item.id);

    return { success: true, journeyId: journeyId || undefined };
  }

  static getItemJourneys(itemId: string, userId: string, limit = 50): TrackingJourneyRecord[] {
    const item = this.getItem(itemId, userId);
    if (!item) return [];

    return (db.prepare(`
      SELECT * FROM tracking_journeys WHERE item_id = ? ORDER BY start_time DESC LIMIT ?
    `).all(itemId, limit) as unknown) as TrackingJourneyRecord[];
  }

  static getJourneyPoints(journeyId: string, userId: string): JourneyPointRecord[] {
    const journey = db.prepare(`
      SELECT j.* FROM tracking_journeys j
      JOIN tracked_items i ON j.item_id = i.id
      WHERE j.id = ? AND i.user_id = ?
    `).get(journeyId, userId);

    if (!journey) return [];

    const rawPoints = (db.prepare(`
      SELECT id, latitude, longitude, speed, heading, accuracy, battery_level, speed_limit, road_name, is_speeding, timestamp
      FROM tracking_locations_raw WHERE journey_id = ? ORDER BY timestamp ASC
    `).all(journeyId) as unknown) as JourneyPointRecord[];

    if (rawPoints.length > 0) return rawPoints;

    return (db.prepare(`
      SELECT id, latitude, longitude, speed, heading, NULL as accuracy, NULL as battery_level, speed_limit, NULL as road_name, is_speeding, timestamp
      FROM tracking_locations_downsampled WHERE journey_id = ? ORDER BY timestamp ASC
    `).all(journeyId) as unknown) as JourneyPointRecord[];
  }

  static runRetentionJob(): void {
    const nowSec = Math.floor(Date.now() / 1000);
    const sevenDaysAgo = nowSec - (7 * 86400);
    const oneHundredTwentyDaysAgo = nowSec - (120 * 86400);

    try {
      const olderPoints = (db.prepare(`
        SELECT id, item_id, latitude, longitude, speed, heading, speed_limit, is_speeding, timestamp, journey_id
        FROM tracking_locations_raw WHERE timestamp < ? ORDER BY item_id, timestamp ASC LIMIT 2000
      `).all(sevenDaysAgo) as unknown) as any[];

      if (olderPoints.length > 0) {
        const insertDown = db.prepare(`
          INSERT OR IGNORE INTO tracking_locations_downsampled (
            id, item_id, latitude, longitude, speed, heading, speed_limit, is_speeding, timestamp, journey_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const p of olderPoints) {
          insertDown.run(p.id, p.item_id, p.latitude, p.longitude, p.speed, p.heading, p.speed_limit, p.is_speeding, p.timestamp, p.journey_id);
        }

        db.prepare("DELETE FROM tracking_locations_raw WHERE timestamp < ?").run(sevenDaysAgo);
      }

      db.prepare("DELETE FROM tracking_locations_downsampled WHERE timestamp < ?").run(oneHundredTwentyDaysAgo);
      db.prepare("DELETE FROM tracking_journeys WHERE end_time IS NOT NULL AND end_time < ?").run(oneHundredTwentyDaysAgo);
      db.prepare("DELETE FROM osm_speed_limits_cache WHERE cached_at < ?").run(nowSec - (30 * 86400));
    } catch (err: any) {
      console.error("[Tracking Retention Error]:", err.message);
    }
  }

  static startBackgroundJob(): void {
    if (this.retentionInterval) clearInterval(this.retentionInterval);
    this.runRetentionJob();
    this.retentionInterval = setInterval(() => { this.runRetentionJob(); }, 3600 * 1000);
  }
}
