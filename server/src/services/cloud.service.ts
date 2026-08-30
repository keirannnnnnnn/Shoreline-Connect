import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Response, Request } from 'express';
import Busboy from 'busboy';
import bcrypt from 'bcryptjs';
import { db } from '../db/database.js';
import { config } from '../config/env.js';

export interface CloudItem {
  name: string;
  type: 'file' | 'folder';
  size_bytes: number | null;
  modified_at: string;
  mime_type: string | null;
  path: string;
}

export interface CloudShareRecord {
  id: string;
  token: string;
  user_id: string;
  username: string;
  share_type: 'permanent' | 'quick_link';
  virtual_path: string | null;
  temp_filename: string | null;
  original_filename: string;
  file_size_bytes: number;
  mime_type: string;
  pin_hash: string | null;
  expires_at: number | null;
  revoked_at: number | null;
  download_count: number;
  created_at: number;
}

export interface QuickLinkAuditRecord {
  id: string;
  share_id: string;
  user_id: string;
  username: string;
  filename: string;
  file_size_bytes: number;
  created_at: number;
  expires_at: number | null;
  had_pin: number;
  outcome: 'active' | 'expired' | 'revoked';
  revoked_at: number | null;
  download_count: number;
}

const EXTENSION_MIME_MAP: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.7z': 'application/x-7z-compressed',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function getMimeType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  return EXTENSION_MIME_MAP[ext] || 'application/octet-stream';
}

export class CloudService {
  static getBasePath(): string {
    const row = db.prepare("SELECT value FROM system_settings WHERE key = 'cloud_storage_base_path'").get() as { value?: string } | undefined;
    if (row && row.value && row.value.trim().length > 0) {
      return path.resolve(row.value.trim());
    }
    return path.join(config.dataDir, 'cloud');
  }

  static getUserFilesDir(username: string): string {
    return path.join(this.getBasePath(), 'Users', username, 'files');
  }

  static getUserTempDir(username: string): string {
    return path.join(this.getBasePath(), 'Users', username, 'temp');
  }

  static ensureUserDirs(username: string): void {
    const filesDir = this.getUserFilesDir(username);
    const tempDir = this.getUserTempDir(username);
    if (!fs.existsSync(filesDir)) {
      fs.mkdirSync(filesDir, { recursive: true });
    }
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  }

  static safeResolvePath(baseDir: string, virtualPath: string = ''): string | null {
    const normalizedBase = path.resolve(baseDir);
    if (virtualPath.includes('..') || virtualPath.includes('\0')) {
      return null;
    }

    const segments = virtualPath
      .replace(/\\/g, '/')
      .split('/')
      .filter((s) => s.trim().length > 0 && s !== '.');

    const resolved = path.resolve(normalizedBase, ...segments);
    if (resolved === normalizedBase || resolved.startsWith(normalizedBase + path.sep)) {
      return resolved;
    }
    return null;
  }

  static listDirectory(username: string, subPath: string = ''): CloudItem[] {
    this.ensureUserDirs(username);
    const baseFilesDir = this.getUserFilesDir(username);
    const targetDir = this.safeResolvePath(baseFilesDir, subPath);
    if (!targetDir || !fs.existsSync(targetDir)) {
      throw new Error('Directory not found or access denied');
    }

    const stat = fs.statSync(targetDir);
    if (!stat.isDirectory()) {
      throw new Error('Path is not a directory');
    }

    const entries = fs.readdirSync(targetDir, { withFileTypes: true });
    const items: CloudItem[] = [];

    for (const entry of entries) {
      const entryPath = path.join(targetDir, entry.name);
      try {
        const entryStat = fs.statSync(entryPath);
        const relPath = path.relative(baseFilesDir, entryPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          items.push({
            name: entry.name,
            type: 'folder',
            size_bytes: null,
            modified_at: entryStat.mtime.toISOString(),
            mime_type: null,
            path: relPath,
          });
        } else if (entry.isFile()) {
          items.push({
            name: entry.name,
            type: 'file',
            size_bytes: entryStat.size,
            modified_at: entryStat.mtime.toISOString(),
            mime_type: getMimeType(entry.name),
            path: relPath,
          });
        }
      } catch {
        // Skip unreadable files
      }
    }

    items.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'folder' ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return items;
  }

  static createFolder(username: string, targetPath: string): void {
    this.ensureUserDirs(username);
    const baseFilesDir = this.getUserFilesDir(username);
    const fullPath = this.safeResolvePath(baseFilesDir, targetPath);
    if (!fullPath) {
      throw new Error('Invalid folder path');
    }
    if (fs.existsSync(fullPath)) {
      throw new Error('A folder or file with this name already exists');
    }
    fs.mkdirSync(fullPath, { recursive: true });
  }

  static renameItem(username: string, oldVirtualPath: string, newName: string): void {
    this.ensureUserDirs(username);
    const cleanName = path.basename(newName.trim());
    if (!cleanName || cleanName.includes('/') || cleanName.includes('\\') || cleanName === '..') {
      throw new Error('Invalid new name');
    }

    const baseFilesDir = this.getUserFilesDir(username);
    const oldFullPath = this.safeResolvePath(baseFilesDir, oldVirtualPath);
    if (!oldFullPath || !fs.existsSync(oldFullPath)) {
      throw new Error('Source item not found');
    }

    const parentDir = path.dirname(oldFullPath);
    const newFullPath = path.join(parentDir, cleanName);

    if (fs.existsSync(newFullPath)) {
      throw new Error('An item with the destination name already exists');
    }

    fs.renameSync(oldFullPath, newFullPath);
  }

  static moveItem(username: string, srcVirtualPath: string, destVirtualDir: string): void {
    this.ensureUserDirs(username);
    const baseFilesDir = this.getUserFilesDir(username);
    const srcFullPath = this.safeResolvePath(baseFilesDir, srcVirtualPath);
    const destDirFullPath = this.safeResolvePath(baseFilesDir, destVirtualDir);

    if (!srcFullPath || !fs.existsSync(srcFullPath)) {
      throw new Error('Source item not found');
    }
    if (!destDirFullPath || !fs.existsSync(destDirFullPath)) {
      throw new Error('Destination folder not found');
    }

    const destStat = fs.statSync(destDirFullPath);
    if (!destStat.isDirectory()) {
      throw new Error('Destination must be a folder');
    }

    const itemName = path.basename(srcFullPath);
    const targetPath = path.join(destDirFullPath, itemName);

    if (fs.existsSync(targetPath)) {
      throw new Error(`An item named "${itemName}" already exists in the destination folder`);
    }

    fs.renameSync(srcFullPath, targetPath);
  }

  static deleteItem(username: string, virtualPath: string): void {
    this.ensureUserDirs(username);
    const baseFilesDir = this.getUserFilesDir(username);
    const fullPath = this.safeResolvePath(baseFilesDir, virtualPath);

    if (!fullPath || !fs.existsSync(fullPath)) {
      throw new Error('Item not found or access denied');
    }
    if (fullPath === baseFilesDir) {
      throw new Error('Cannot delete root files folder');
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
  }

  static streamUploadPermanent(
    username: string,
    targetVirtualDir: string,
    req: Request
  ): Promise<{ filename: string; path: string; sizeBytes: number; mimeType: string }> {
    this.ensureUserDirs(username);
    const baseFilesDir = this.getUserFilesDir(username);
    const destDir = this.safeResolvePath(baseFilesDir, targetVirtualDir);
    if (!destDir || !fs.existsSync(destDir)) {
      return Promise.reject(new Error('Target directory not found'));
    }

    return new Promise((resolve, reject) => {
      const busboy = Busboy({ headers: req.headers });
      let uploadedFile: { filename: string; path: string; sizeBytes: number; mimeType: string } | null = null;

      busboy.on('file', (_name, fileStream, info) => {
        const origFilename = path.basename(info.filename);
        const safeName = origFilename.replace(/[<>:"/\\|?*]/g, '_');
        let finalPath = path.join(destDir, safeName);

        let counter = 1;
        const ext = path.extname(safeName);
        const nameWithoutExt = path.basename(safeName, ext);
        while (fs.existsSync(finalPath)) {
          finalPath = path.join(destDir, `${nameWithoutExt} (${counter})${ext}`);
          counter++;
        }

        const writeStream = fs.createWriteStream(finalPath);
        let sizeBytes = 0;

        fileStream.on('data', (chunk: Buffer) => {
          sizeBytes += chunk.length;
        });

        fileStream.pipe(writeStream);

        writeStream.on('finish', () => {
          const relPath = path.relative(baseFilesDir, finalPath).replace(/\\/g, '/');
          uploadedFile = {
            filename: path.basename(finalPath),
            path: relPath,
            sizeBytes,
            mimeType: info.mimeType || getMimeType(finalPath),
          };
        });

        writeStream.on('error', (err) => {
          reject(err);
        });
      });

      busboy.on('error', (err) => {
        reject(err);
      });

      busboy.on('finish', () => {
        if (!uploadedFile) {
          return reject(new Error('No file received in request'));
        }
        resolve(uploadedFile);
      });

      req.pipe(busboy);
    });
  }

  static streamUploadQuickLink(
    user: { id: string; username: string },
    req: Request,
    options: { expiresInSeconds: number | null; pinPlaintext?: string }
  ): Promise<{ shareId: string; token: string; filename: string; sizeBytes: number; expiresAt: number | null }> {
    this.ensureUserDirs(user.username);
    const tempDir = this.getUserTempDir(user.username);

    return new Promise((resolve, reject) => {
      const busboy = Busboy({ headers: req.headers });
      let fileData: { tempFilename: string; origFilename: string; sizeBytes: number; mimeType: string } | null = null;
      let formExpiry = options.expiresInSeconds;
      let formPin = options.pinPlaintext;

      busboy.on('field', (name, val) => {
        if (name === 'expiresInSeconds' && val) {
          formExpiry = parseInt(val, 10);
        }
        if (name === 'pin' && val) {
          formPin = val;
        }
      });

      busboy.on('file', (_name, fileStream, info) => {
        const origFilename = path.basename(info.filename);
        const randomPrefix = crypto.randomBytes(8).toString('hex');
        const safeName = `${randomPrefix}_${origFilename.replace(/[<>:"/\\|?*]/g, '_')}`;
        const finalPath = path.join(tempDir, safeName);

        const writeStream = fs.createWriteStream(finalPath);
        let sizeBytes = 0;

        fileStream.on('data', (chunk: Buffer) => {
          sizeBytes += chunk.length;
        });

        fileStream.pipe(writeStream);

        writeStream.on('finish', () => {
          fileData = {
            tempFilename: safeName,
            origFilename,
            sizeBytes,
            mimeType: info.mimeType || getMimeType(origFilename),
          };
        });

        writeStream.on('error', (err) => {
          reject(err);
        });
      });

      busboy.on('error', (err) => {
        reject(err);
      });

      busboy.on('finish', () => {
        if (!fileData) {
          return reject(new Error('No file uploaded'));
        }

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = formExpiry ? now + formExpiry : null;
        const shareId = crypto.randomUUID();
        const token = 'sh_cld_' + crypto.randomBytes(20).toString('hex');
        const pinHash = formPin && formPin.trim().length > 0 ? bcrypt.hashSync(formPin.trim(), 10) : null;

        db.prepare(`
          INSERT INTO cloud_shares (
            id, token, user_id, username, share_type, virtual_path, temp_filename,
            original_filename, file_size_bytes, mime_type, pin_hash, expires_at,
            download_count, created_at
          ) VALUES (?, ?, ?, ?, 'quick_link', NULL, ?, ?, ?, ?, ?, ?, 0, ?)
        `).run(
          shareId,
          token,
          user.id,
          user.username,
          fileData.tempFilename,
          fileData.origFilename,
          fileData.sizeBytes,
          fileData.mimeType,
          pinHash,
          expiresAt,
          now
        );

        const auditId = crypto.randomUUID();
        db.prepare(`
          INSERT INTO cloud_quick_link_audit (
            id, share_id, user_id, username, filename, file_size_bytes,
            created_at, expires_at, had_pin, outcome, download_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0)
        `).run(
          auditId,
          shareId,
          user.id,
          user.username,
          fileData.origFilename,
          fileData.sizeBytes,
          now,
          expiresAt,
          pinHash ? 1 : 0
        );

        resolve({
          shareId,
          token,
          filename: fileData.origFilename,
          sizeBytes: fileData.sizeBytes,
          expiresAt,
        });
      });

      req.pipe(busboy);
    });
  }

  static createPermanentShare(
    user: { id: string; username: string },
    virtualPath: string,
    options: { expiresInSeconds?: number | null; pinPlaintext?: string } = {}
  ): { shareId: string; token: string; expiresAt: number | null } {
    this.ensureUserDirs(user.username);
    const baseFilesDir = this.getUserFilesDir(user.username);
    const fullPath = this.safeResolvePath(baseFilesDir, virtualPath);

    if (!fullPath || !fs.existsSync(fullPath)) {
      throw new Error('File not found');
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      throw new Error('Only files can be shared via link');
    }

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = options.expiresInSeconds ? now + options.expiresInSeconds : null;
    const shareId = crypto.randomUUID();
    const token = 'sh_cld_' + crypto.randomBytes(20).toString('hex');
    const pinHash = options.pinPlaintext && options.pinPlaintext.trim().length > 0
      ? bcrypt.hashSync(options.pinPlaintext.trim(), 10)
      : null;
    const origFilename = path.basename(fullPath);
    const mimeType = getMimeType(origFilename);

    db.prepare(`
      INSERT INTO cloud_shares (
        id, token, user_id, username, share_type, virtual_path, temp_filename,
        original_filename, file_size_bytes, mime_type, pin_hash, expires_at,
        download_count, created_at
      ) VALUES (?, ?, ?, ?, 'permanent', ?, NULL, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      shareId,
      token,
      user.id,
      user.username,
      virtualPath,
      origFilename,
      stat.size,
      mimeType,
      pinHash,
      expiresAt,
      now
    );

    return { shareId, token, expiresAt };
  }

  static getSharesByUser(userId: string): CloudShareRecord[] {
    return db.prepare(`
      SELECT * FROM cloud_shares
      WHERE user_id = ? AND revoked_at IS NULL
      ORDER BY created_at DESC
    `).all(userId) as unknown as CloudShareRecord[];
  }

  static revokeShare(shareId: string, userId: string, isAdmin = false): void {
    const share = db.prepare('SELECT * FROM cloud_shares WHERE id = ?').get(shareId) as CloudShareRecord | undefined;
    if (!share) {
      throw new Error('Share link not found');
    }

    if (!isAdmin && share.user_id !== userId) {
      throw new Error('Forbidden: You do not own this share link');
    }

    const now = Math.floor(Date.now() / 1000);

    db.prepare('UPDATE cloud_shares SET revoked_at = ? WHERE id = ?').run(now, shareId);

    if (share.share_type === 'quick_link') {
      if (share.temp_filename) {
        const tempDir = this.getUserTempDir(share.username);
        const tempFilePath = path.join(tempDir, share.temp_filename);
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (err) {
          console.error('Failed to delete temp file:', err);
        }
      }

      db.prepare(`
        UPDATE cloud_quick_link_audit
        SET outcome = 'revoked', revoked_at = ?
        WHERE share_id = ?
      `).run(now, shareId);
    }
  }

  static getPublicShare(token: string): (CloudShareRecord & { has_pin: boolean }) | null {
    const share = db.prepare('SELECT * FROM cloud_shares WHERE token = ?').get(token) as CloudShareRecord | undefined;
    if (!share) return null;

    const now = Math.floor(Date.now() / 1000);

    if (share.revoked_at !== null) return null;

    if (share.expires_at !== null && share.expires_at <= now) {
      this.cleanupExpiredShare(share);
      return null;
    }

    return {
      ...share,
      has_pin: share.pin_hash !== null && share.pin_hash.length > 0,
    };
  }

  static verifySharePin(share: CloudShareRecord, pinPlaintext: string): boolean {
    if (!share.pin_hash) return true;
    if (!pinPlaintext) return false;
    return bcrypt.compareSync(pinPlaintext, share.pin_hash);
  }

  static streamDownloadShare(share: CloudShareRecord, res: Response): void {
    let filePath: string | null = null;

    if (share.share_type === 'permanent') {
      if (!share.virtual_path) throw new Error('Missing file virtual path');
      const baseFilesDir = this.getUserFilesDir(share.username);
      filePath = this.safeResolvePath(baseFilesDir, share.virtual_path);
    } else {
      if (!share.temp_filename) throw new Error('Missing temp file');
      const tempDir = this.getUserTempDir(share.username);
      filePath = path.join(tempDir, share.temp_filename);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      throw new Error('Underlying file no longer exists on disk');
    }

    const stat = fs.statSync(filePath);

    db.prepare('UPDATE cloud_shares SET download_count = download_count + 1 WHERE id = ?').run(share.id);
    if (share.share_type === 'quick_link') {
      db.prepare('UPDATE cloud_quick_link_audit SET download_count = download_count + 1 WHERE share_id = ?').run(share.id);
    }

    const encodedFilename = encodeURIComponent(share.original_filename);
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-Type', share.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(filePath);
    readStream.pipe(res);
  }

  static streamDownloadUserFile(username: string, virtualPath: string, res: Response): void {
    this.ensureUserDirs(username);
    const baseFilesDir = this.getUserFilesDir(username);
    const fullPath = this.safeResolvePath(baseFilesDir, virtualPath);

    if (!fullPath || !fs.existsSync(fullPath)) {
      throw new Error('File not found');
    }

    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) {
      throw new Error('Cannot download a directory directly');
    }

    const filename = path.basename(fullPath);
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.setHeader('Content-Type', getMimeType(filename));
    res.setHeader('Content-Length', stat.size);

    const readStream = fs.createReadStream(fullPath);
    readStream.pipe(res);
  }

  static getAuditLogs(userId: string, isAdmin: boolean): QuickLinkAuditRecord[] {
    if (isAdmin) {
      return db.prepare(`
        SELECT * FROM cloud_quick_link_audit
        ORDER BY created_at DESC
        LIMIT 500
      `).all() as unknown as QuickLinkAuditRecord[];
    }
    return db.prepare(`
      SELECT * FROM cloud_quick_link_audit
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 200
    `).all(userId) as unknown as QuickLinkAuditRecord[];
  }

  private static cleanupExpiredShare(share: CloudShareRecord): void {
    const now = Math.floor(Date.now() / 1000);
    db.prepare('UPDATE cloud_shares SET revoked_at = ? WHERE id = ?').run(now, share.id);

    if (share.share_type === 'quick_link') {
      if (share.temp_filename) {
        const tempDir = this.getUserTempDir(share.username);
        const tempFilePath = path.join(tempDir, share.temp_filename);
        try {
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        } catch (err) {
          console.error('Failed to delete temp file:', err);
        }
      }

      db.prepare(`
        UPDATE cloud_quick_link_audit
        SET outcome = 'expired', revoked_at = ?
        WHERE share_id = ?
      `).run(now, share.id);
    }
  }

  static runExpiryCleanupJob(): void {
    const now = Math.floor(Date.now() / 1000);
    const expiredShares = db.prepare(`
      SELECT * FROM cloud_shares
      WHERE expires_at IS NOT NULL AND expires_at <= ? AND revoked_at IS NULL
    `).all(now) as unknown as CloudShareRecord[];

    for (const share of expiredShares) {
      this.cleanupExpiredShare(share);
    }
  }

  static startBackgroundJob(): void {
    this.runExpiryCleanupJob();
    setInterval(() => {
      try {
        CloudService.runExpiryCleanupJob();
      } catch (err) {
        console.error('Error during cloud expiry cleanup:', err);
      }
    }, 60000);
    console.log('☁️  Cloud storage retention & expiry job initialized.');
  }
}
