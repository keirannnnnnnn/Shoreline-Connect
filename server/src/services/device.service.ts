import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { CryptoService, EncryptedPayload } from './crypto.service.js';

export interface DeviceCredentials {
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface DeviceParameters {
  width?: number;
  height?: number;
  dpi?: number;
  colorDepth?: number;
  audio?: boolean;
  driveRedirect?: boolean;
  domain?: string;
  security?: 'any' | 'nla' | 'tls' | 'rdp';
  ignoreCert?: boolean;
  keyboardLayout?: string;
  timezone?: string;
  fontSize?: number;
  cursorStyle?: string;
  [key: string]: any;
}

export interface DeviceRecord {
  id: string;
  name: string;
  protocol: 'rdp' | 'vnc' | 'ssh';
  host: string;
  port: number;
  encrypted_credentials: string; // JSON string of EncryptedPayload
  parameters: string; // JSON string of DeviceParameters
  folder_id: string | null;
  folder_name?: string | null;
  is_favorite: number;
  owner_id: string;
  owner_username?: string;
  owner_display_name?: string;
  created_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
  is_shared?: boolean;
  shared_by_user?: string;
}

export interface FolderRecord {
  id: string;
  name: string;
  user_id: string;
  icon: string;
  color: string;
  created_at: string;
  device_count?: number;
}

export class DeviceService {
  /**
   * Strictly retrieve all devices visible to a user:
   * 1. Devices owned by the user (owner_id == userId)
   * 2. Devices explicitly shared with the user (via device_shares)
   * ADMIN ISOLATION GUARANTEE: When an admin calls this, it ONLY returns the admin's personal devices!
   */
  static getUserDevices(userId: string): DeviceRecord[] {
    const ownedStmt = db.prepare(`
      SELECT 
        d.id, d.name, d.protocol, d.host, d.port, d.parameters, d.folder_id,
        f.name as folder_name, d.is_favorite, d.owner_id, d.created_by_admin_id,
        d.created_at, d.updated_at,
        0 as is_shared, NULL as shared_by_user
      FROM devices d
      LEFT JOIN folders f ON d.folder_id = f.id
      WHERE d.owner_id = ?
      ORDER BY d.is_favorite DESC, d.name ASC
    `);

    const sharedStmt = db.prepare(`
      SELECT 
        d.id, d.name, d.protocol, d.host, d.port, d.parameters, d.folder_id,
        f.name as folder_name, 0 as is_favorite, d.owner_id, d.created_by_admin_id,
        d.created_at, d.updated_at,
        1 as is_shared, u.display_name as shared_by_user
      FROM device_shares ds
      JOIN devices d ON ds.device_id = d.id
      JOIN users u ON d.owner_id = u.id
      LEFT JOIN folders f ON d.folder_id = f.id
      WHERE ds.shared_with_user_id = ?
      ORDER BY d.name ASC
    `);

    const owned = (ownedStmt.all(userId) as unknown) as DeviceRecord[];
    const shared = (sharedStmt.all(userId) as unknown) as DeviceRecord[];

    return [...owned, ...shared];
  }

  /**
   * Admin view for a specific target user's profile:
   * Returns devices that an admin created on behalf of this target user.
   */
  static getAdminCreatedDevicesForUser(targetUserId: string): DeviceRecord[] {
    const stmt = db.prepare(`
      SELECT 
        d.id, d.name, d.protocol, d.host, d.port, d.parameters, d.folder_id,
        f.name as folder_name, d.is_favorite, d.owner_id, d.created_by_admin_id,
        d.created_at, d.updated_at,
        u.username as owner_username, u.display_name as owner_display_name
      FROM devices d
      LEFT JOIN folders f ON d.folder_id = f.id
      JOIN users u ON d.owner_id = u.id
      WHERE d.owner_id = ?
      ORDER BY d.name ASC
    `);

    return (stmt.all(targetUserId) as unknown) as DeviceRecord[];
  }

  /**
   * Get single device by ID with access verification
   */
  static getDeviceForUser(deviceId: string, userId: string, isAdmin = false): { device: DeviceRecord; canManage: boolean; credentials?: DeviceCredentials } | null {
    const stmt = db.prepare(`
      SELECT 
        d.*, f.name as folder_name, u.display_name as owner_display_name, u.username as owner_username
      FROM devices d
      LEFT JOIN folders f ON d.folder_id = f.id
      LEFT JOIN users u ON d.owner_id = u.id
      WHERE d.id = ?
    `);

    const device = stmt.get(deviceId) as (DeviceRecord & { owner_username: string; owner_display_name: string }) | undefined;
    if (!device) return null;

    // Check if user is the direct owner
    const isOwner = device.owner_id === userId;
    
    // Check if user is an admin who created it on behalf of the owner
    const isAdminCreator = isAdmin && device.created_by_admin_id === userId;

    if (isOwner || isAdminCreator) {
      return {
        device,
        canManage: true,
      };
    }

    // Check if device is shared with user
    const shareStmt = db.prepare('SELECT id FROM device_shares WHERE device_id = ? AND shared_with_user_id = ?');
    const share = shareStmt.get(deviceId, userId);

    if (share) {
      return {
        device: { ...device, is_shared: true },
        canManage: false,
      };
    }

    return null;
  }

  /**
   * Internal retrieval of decrypted device connection info for session connection
   */
  static getDeviceConnectionConfig(deviceId: string): {
    id: string;
    name: string;
    protocol: 'rdp' | 'vnc' | 'ssh';
    host: string;
    port: number;
    credentials: DeviceCredentials;
    parameters: DeviceParameters;
  } | null {
    const stmt = db.prepare('SELECT id, name, protocol, host, port, encrypted_credentials, parameters FROM devices WHERE id = ?');
    const device = stmt.get(deviceId) as any;
    if (!device) return null;

    const encPayload: EncryptedPayload = JSON.parse(device.encrypted_credentials);
    const credentials = CryptoService.decrypt<DeviceCredentials>(encPayload);
    const parameters: DeviceParameters = JSON.parse(device.parameters || '{}');

    return {
      id: device.id,
      name: device.name,
      protocol: device.protocol,
      host: device.host,
      port: device.port,
      credentials,
      parameters,
    };
  }

  /**
   * Create device
   */
  static createDevice(params: {
    name: string;
    protocol: 'rdp' | 'vnc' | 'ssh';
    host: string;
    port?: number;
    credentials: DeviceCredentials;
    parameters?: DeviceParameters;
    folderId?: string | null;
    isFavorite?: boolean;
    ownerId: string;
    createdByAdminId?: string | null;
  }): DeviceRecord {
    const id = uuidv4();
    const defaultPort = params.protocol === 'rdp' ? 3389 : params.protocol === 'ssh' ? 22 : 5900;
    const port = params.port || defaultPort;

    const encryptedCredentials = JSON.stringify(CryptoService.encrypt(params.credentials));
    const parameters = JSON.stringify(params.parameters || {});
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO devices (
        id, name, protocol, host, port, encrypted_credentials, parameters,
        folder_id, is_favorite, owner_id, created_by_admin_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.name.trim(),
      params.protocol,
      params.host.trim(),
      port,
      encryptedCredentials,
      parameters,
      params.folderId || null,
      params.isFavorite ? 1 : 0,
      params.ownerId,
      params.createdByAdminId || null,
      now,
      now
    );

    return (db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as unknown) as DeviceRecord;
  }

  /**
   * Update device
   */
  static updateDevice(deviceId: string, userId: string, isAdmin: boolean, updates: {
    name?: string;
    protocol?: 'rdp' | 'vnc' | 'ssh';
    host?: string;
    port?: number;
    credentials?: DeviceCredentials;
    parameters?: DeviceParameters;
    folderId?: string | null;
    isFavorite?: boolean;
  }): DeviceRecord {
    const device = (db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as unknown) as DeviceRecord | undefined;
    if (!device) throw new Error('Device not found');

    const isOwner = device.owner_id === userId;
    const isAdminCreator = isAdmin && device.created_by_admin_id === userId;

    if (!isOwner && !isAdminCreator) {
      throw new Error('Unauthorized: Only the owner or creating admin can update this device');
    }

    const name = updates.name !== undefined ? updates.name.trim() : device.name;
    const protocol = updates.protocol || device.protocol;
    const host = updates.host !== undefined ? updates.host.trim() : device.host;
    const port = updates.port !== undefined ? updates.port : device.port;
    const folderId = updates.folderId !== undefined ? updates.folderId : device.folder_id;
    const isFavorite = updates.isFavorite !== undefined ? (updates.isFavorite ? 1 : 0) : device.is_favorite;
    
    let encryptedCredentials = device.encrypted_credentials;
    if (updates.credentials && (updates.credentials.username !== undefined || updates.credentials.password !== undefined || updates.credentials.privateKey !== undefined)) {
      // Merge with existing decrypted if partial
      const oldPayload: EncryptedPayload = JSON.parse(device.encrypted_credentials);
      const oldCreds = CryptoService.decrypt<DeviceCredentials>(oldPayload);
      const mergedCreds = { ...oldCreds, ...updates.credentials };
      encryptedCredentials = JSON.stringify(CryptoService.encrypt(mergedCreds));
    }

    const parameters = updates.parameters !== undefined ? JSON.stringify(updates.parameters) : device.parameters;
    const now = new Date().toISOString();

    db.prepare(`
      UPDATE devices 
      SET name = ?, protocol = ?, host = ?, port = ?, encrypted_credentials = ?,
          parameters = ?, folder_id = ?, is_favorite = ?, updated_at = ?
      WHERE id = ?
    `).run(name, protocol, host, port, encryptedCredentials, parameters, folderId, isFavorite, now, deviceId);

    return (db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as unknown) as DeviceRecord;
  }

  /**
   * Delete device
   */
  static deleteDevice(deviceId: string, userId: string, isAdmin: boolean): boolean {
    const device = (db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId) as unknown) as DeviceRecord | undefined;
    if (!device) throw new Error('Device not found');

    const isOwner = device.owner_id === userId;
    const isAdminCreator = isAdmin && device.created_by_admin_id === userId;

    if (!isOwner && !isAdminCreator) {
      throw new Error('Unauthorized: Only the owner or creating admin can delete this device');
    }

    db.prepare('DELETE FROM devices WHERE id = ?').run(deviceId);
    return true;
  }

  /**
   * Toggle favorite
   */
  static toggleFavorite(deviceId: string, userId: string): boolean {
    const device = (db.prepare('SELECT is_favorite, owner_id FROM devices WHERE id = ?').get(deviceId) as unknown) as { is_favorite: number; owner_id: string } | undefined;
    if (!device || device.owner_id !== userId) {
      throw new Error('Device not found or not owned by user');
    }

    const newFav = device.is_favorite ? 0 : 1;
    db.prepare('UPDATE devices SET is_favorite = ? WHERE id = ?').run(newFav, deviceId);
    return newFav === 1;
  }

  /**
   * Folders CRUD for user
   */
  static getUserFolders(userId: string): FolderRecord[] {
    const stmt = db.prepare(`
      SELECT f.*, COUNT(d.id) as device_count
      FROM folders f
      LEFT JOIN devices d ON f.id = d.folder_id
      WHERE f.user_id = ?
      GROUP BY f.id
      ORDER BY f.name ASC
    `);
    return (stmt.all(userId) as unknown) as FolderRecord[];
  }

  static createFolder(userId: string, name: string, icon = 'folder.fill', color = '#3b82f6', deviceIds?: string[]): FolderRecord {
    const id = uuidv4();
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO folders (id, name, user_id, icon, color, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name.trim(), userId, icon, color, now);

    if (deviceIds && Array.isArray(deviceIds) && deviceIds.length > 0) {
      const updateStmt = db.prepare('UPDATE devices SET folder_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?');
      for (const devId of deviceIds) {
        updateStmt.run(id, now, devId, userId);
      }
    }

    return (db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as unknown) as FolderRecord;
  }

  static updateFolderDevices(folderId: string, userId: string, deviceIds: string[]): boolean {
    const folder = db.prepare('SELECT user_id FROM folders WHERE id = ?').get(folderId) as { user_id: string } | undefined;
    if (!folder || folder.user_id !== userId) {
      throw new Error('Folder not found or unauthorized');
    }

    const now = new Date().toISOString();

    // 1. Remove folder assignment from devices currently in this folder that are not in the new list
    db.prepare('UPDATE devices SET folder_id = NULL, updated_at = ? WHERE folder_id = ? AND owner_id = ?').run(now, folderId, userId);

    // 2. Assign specified devices to this folder
    if (deviceIds && Array.isArray(deviceIds) && deviceIds.length > 0) {
      const assignStmt = db.prepare('UPDATE devices SET folder_id = ?, updated_at = ? WHERE id = ? AND owner_id = ?');
      for (const devId of deviceIds) {
        assignStmt.run(folderId, now, devId, userId);
      }
    }

    return true;
  }

  static deleteFolder(folderId: string, userId: string): boolean {
    const folder = db.prepare('SELECT user_id FROM folders WHERE id = ?').get(folderId) as { user_id: string } | undefined;
    if (!folder || folder.user_id !== userId) {
      throw new Error('Folder not found or unauthorized');
    }

    // Move devices out of folder before deleting
    db.prepare('UPDATE devices SET folder_id = NULL WHERE folder_id = ?').run(folderId);
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
    return true;
  }
}
