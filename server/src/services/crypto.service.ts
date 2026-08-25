import crypto from 'crypto';
import { config } from '../config/env.js';

// Derive 32-byte key from encryptionKey
const masterKey = crypto.createHash('sha256').update(config.encryptionKey).digest();

export interface EncryptedPayload {
  iv: string;
  authTag: string;
  data: string;
}

export class CryptoService {
  /**
   * Encrypts plain text or JSON object with AES-256-GCM
   */
  static encrypt(value: unknown): EncryptedPayload {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    
    const stringified = typeof value === 'string' ? value : JSON.stringify(value);
    let encrypted = cipher.update(stringified, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return {
      iv: iv.toString('hex'),
      authTag,
      data: encrypted,
    };
  }

  /**
   * Decrypts AES-256-GCM payload
   */
  static decrypt<T = any>(payload: EncryptedPayload): T {
    if (!payload || !payload.iv || !payload.authTag || !payload.data) {
      throw new Error('Invalid encrypted payload structure');
    }

    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
    
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    try {
      return JSON.parse(decrypted);
    } catch {
      return decrypted as unknown as T;
    }
  }

  /**
   * Hash a PIN or token using SHA-256 for quick lookup or verification
   */
  static hashSha256(text: string): string {
    return crypto.createHash('sha256').update(text).digest('hex');
  }
}
