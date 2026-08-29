import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';

export interface DeviceShareRecord {
  id: string;
  device_id: string;
  device_name?: string;
  shared_with_user_id: string;
  shared_with_username?: string;
  shared_with_display_name?: string;
  created_by_user_id: string;
  created_at: string;
}

export interface GuestShareRecord {
  id: string;
  token: string;
  device_id: string;
  device_name?: string;
  protocol?: string;
  created_by_user_id: string;
  created_by_name?: string;
  has_pin: boolean;
  duration_label: string;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
  is_expired?: boolean;
}

export class SharingService {
  /**
   * 1. USER-TO-USER INTERNAL SHARING
   */

  /**
   * Share a device with another Shoreline user
   */
  static shareDeviceWithUser(deviceId: string, targetUserId: string, currentUserId: string): DeviceShareRecord {
    // Check device ownership
    const device = db.prepare('SELECT owner_id, name FROM devices WHERE id = ?').get(deviceId) as { owner_id: string; name: string } | undefined;
    if (!device || device.owner_id !== currentUserId) {
      throw new Error('Unauthorized: Only the device owner can share this device');
    }

    if (targetUserId === currentUserId) {
      throw new Error('Cannot share a device with yourself');
    }

    // Check if target user exists
    const targetUser = db.prepare('SELECT id FROM users WHERE id = ?').get(targetUserId);
    if (!targetUser) {
      throw new Error('Target user not found');
    }

    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO device_shares (id, device_id, shared_with_user_id, created_by_user_id, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (device_id, shared_with_user_id) DO NOTHING
    `).run(id, deviceId, targetUserId, currentUserId, now);

    return this.getDeviceShareById(id) || {
      id,
      device_id: deviceId,
      shared_with_user_id: targetUserId,
      created_by_user_id: currentUserId,
      created_at: now
    };
  }

  /**
   * Revoke user-to-user sharing
   */
  static revokeUserShare(shareId: string, currentUserId: string): boolean {
    const share = db.prepare(`
      SELECT ds.id, d.owner_id 
      FROM device_shares ds
      JOIN devices d ON ds.device_id = d.id
      WHERE ds.id = ?
    `).get(shareId) as { id: string; owner_id: string } | undefined;

    if (!share || share.owner_id !== currentUserId) {
      throw new Error('Unauthorized or share not found');
    }

    db.prepare('DELETE FROM device_shares WHERE id = ?').run(shareId);
    return true;
  }

  /**
   * Get all active shares for a device (owner view)
   */
  static getSharesForDevice(deviceId: string, currentUserId: string): DeviceShareRecord[] {
    const device = db.prepare('SELECT owner_id FROM devices WHERE id = ?').get(deviceId) as { owner_id: string } | undefined;
    if (!device || device.owner_id !== currentUserId) {
      throw new Error('Unauthorized: Device not owned by user');
    }

    const stmt = db.prepare(`
      SELECT 
        ds.id, ds.device_id, ds.shared_with_user_id, ds.created_by_user_id, ds.created_at,
        u.username as shared_with_username, u.display_name as shared_with_display_name
      FROM device_shares ds
      JOIN users u ON ds.shared_with_user_id = u.id
      WHERE ds.device_id = ?
      ORDER BY ds.created_at DESC
    `);

    return (stmt.all(deviceId) as unknown) as DeviceShareRecord[];
  }

  private static getDeviceShareById(id: string): DeviceShareRecord | undefined {
    return db.prepare(`
      SELECT 
        ds.id, ds.device_id, ds.shared_with_user_id, ds.created_by_user_id, ds.created_at,
        u.username as shared_with_username, u.display_name as shared_with_display_name
      FROM device_shares ds
      JOIN users u ON ds.shared_with_user_id = u.id
      WHERE ds.id = ?
    `).get(id) as DeviceShareRecord | undefined;
  }

  /**
   * 2. GUEST SHARE LINKS (EXTERNAL, NO ACCOUNT NEEDED)
   */

  /**
   * Create a guest share link with duration presets and optional PIN
   */
  static async createGuestShareLink(params: {
    deviceId: string;
    currentUserId: string;
    durationMinutes: number;
    durationLabel: string;
    pin?: string;
    maxUses?: number;
  }): Promise<GuestShareRecord & { rawPin?: string }> {
    const device = db.prepare('SELECT owner_id, name FROM devices WHERE id = ?').get(params.deviceId) as { owner_id: string; name: string } | undefined;
    if (!device || device.owner_id !== params.currentUserId) {
      throw new Error('Unauthorized: Only the device owner can generate guest links');
    }

    const id = uuidv4();
    const token = crypto.randomBytes(24).toString('base64url');
    
    let pinHash: string | null = null;
    if (params.pin && params.pin.trim().length > 0) {
      pinHash = await bcrypt.hash(params.pin.trim(), 10);
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + params.durationMinutes * 60 * 1000).toISOString();
    const createdAt = now.toISOString();

    db.prepare(`
      INSERT INTO guest_shares (
        id, token, device_id, created_by_user_id, pin_hash,
        duration_label, expires_at, max_uses, use_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      id,
      token,
      params.deviceId,
      params.currentUserId,
      pinHash,
      params.durationLabel,
      expiresAt,
      params.maxUses || null,
      createdAt
    );

    return {
      id,
      token,
      device_id: params.deviceId,
      device_name: device.name,
      created_by_user_id: params.currentUserId,
      has_pin: !!pinHash,
      duration_label: params.durationLabel,
      expires_at: expiresAt,
      max_uses: params.maxUses || null,
      use_count: 0,
      revoked_at: null,
      created_at: createdAt,
      rawPin: params.pin ? params.pin.trim() : undefined,
    };
  }

  /**
   * Get guest share information by token (public endpoint)
   */
  static getGuestShareByToken(token: string): {
    valid: boolean;
    reason?: 'not_found' | 'expired' | 'revoked' | 'max_uses_reached';
    share?: {
      id: string;
      token: string;
      deviceId: string;
      deviceName: string;
      protocol: string;
      creatorName: string;
      hasPin: boolean;
      expiresAt: string;
    };
  } {
    const stmt = db.prepare(`
      SELECT 
        gs.*, d.name as device_name, d.protocol, u.display_name as creator_name
      FROM guest_shares gs
      JOIN devices d ON gs.device_id = d.id
      JOIN users u ON gs.created_by_user_id = u.id
      WHERE gs.token = ?
    `);

    const row = stmt.get(token) as any;
    if (!row) {
      return { valid: false, reason: 'not_found' };
    }

    if (row.revoked_at) {
      return { valid: false, reason: 'revoked' };
    }

    const now = new Date();
    const expiresAt = new Date(row.expires_at);
    if (now > expiresAt) {
      return { valid: false, reason: 'expired' };
    }

    if (row.max_uses && row.use_count >= row.max_uses) {
      return { valid: false, reason: 'max_uses_reached' };
    }

    return {
      valid: true,
      share: {
        id: row.id,
        token: row.token,
        deviceId: row.device_id,
        deviceName: row.device_name,
        protocol: row.protocol,
        creatorName: row.creator_name,
        hasPin: !!row.pin_hash,
        expiresAt: row.expires_at,
      }
    };
  }

  /**
   * Validate PIN for guest share session access
   */
  static async verifyGuestPin(token: string, pinInput?: string): Promise<boolean> {
    const row = db.prepare('SELECT pin_hash, expires_at, revoked_at FROM guest_shares WHERE token = ?').get(token) as { pin_hash: string | null; expires_at: string; revoked_at: string | null } | undefined;
    if (!row || row.revoked_at || new Date() > new Date(row.expires_at)) {
      return false;
    }

    if (!row.pin_hash) {
      return true; // No PIN required
    }

    if (!pinInput) {
      return false;
    }

    return bcrypt.compare(pinInput.trim(), row.pin_hash);
  }

  /**
   * Record use of guest share
   */
  static recordGuestShareUse(guestShareId: string) {
    db.prepare('UPDATE guest_shares SET use_count = use_count + 1 WHERE id = ?').run(guestShareId);
  }

  /**
   * Revoke guest share link
   */
  static revokeGuestShare(shareId: string, currentUserId: string): boolean {
    const share = db.prepare(`
      SELECT gs.id, gs.created_by_user_id, gs.device_id, d.owner_id as device_owner_id
      FROM guest_shares gs
      JOIN devices d ON gs.device_id = d.id
      WHERE gs.id = ?
    `).get(shareId) as { id: string; created_by_user_id: string; device_id: string; device_owner_id: string } | undefined;

    if (!share) {
      throw new Error('Guest link not found');
    }

    const currentUser = db.prepare('SELECT role FROM users WHERE id = ?').get(currentUserId) as { role: string } | undefined;
    const isAdmin = currentUser?.role === 'admin';

    if (share.created_by_user_id !== currentUserId && share.device_owner_id !== currentUserId && !isAdmin) {
      throw new Error('Unauthorized to revoke this guest link');
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE guest_shares SET revoked_at = ? WHERE id = ?').run(now, shareId);
    return true;
  }

  /**
   * Get all guest links created by user
   */
  static getUserGuestShares(userId: string): GuestShareRecord[] {
    const stmt = db.prepare(`
      SELECT 
        gs.id, gs.token, gs.device_id, gs.created_by_user_id, gs.duration_label,
        gs.expires_at, gs.max_uses, gs.use_count, gs.revoked_at, gs.created_at,
        d.name as device_name, d.protocol,
        CASE WHEN gs.pin_hash IS NOT NULL THEN 1 ELSE 0 END as has_pin,
        CASE WHEN datetime('now') > datetime(gs.expires_at) OR gs.revoked_at IS NOT NULL THEN 1 ELSE 0 END as is_expired
      FROM guest_shares gs
      JOIN devices d ON gs.device_id = d.id
      WHERE gs.created_by_user_id = ?
      ORDER BY gs.created_at DESC
    `);

    return stmt.all(userId).map((row: any) => ({
      ...row,
      has_pin: row.has_pin === 1,
      is_expired: row.is_expired === 1,
    }));
  }
}
