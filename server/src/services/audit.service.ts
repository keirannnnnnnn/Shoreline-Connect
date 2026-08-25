import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';

export interface SessionLogRecord {
  id: string;
  session_id: string;
  user_id: string | null;
  user_display_name?: string | null;
  user_username?: string | null;
  guest_share_id: string | null;
  device_id: string;
  device_name: string;
  protocol: string;
  connection_method: 'owner' | 'shared_user' | 'guest_link';
  client_ip: string | null;
  user_agent: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds?: number | null;
  status: 'active' | 'closed' | 'failed';
  error_message: string | null;
}

export class AuditService {
  /**
   * Start recording a new connection session
   */
  static startSession(params: {
    sessionId: string;
    userId?: string | null;
    guestShareId?: string | null;
    deviceId: string;
    deviceName: string;
    protocol: string;
    connectionMethod: 'owner' | 'shared_user' | 'guest_link';
    clientIp?: string | null;
    userAgent?: string | null;
  }): string {
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO session_logs (
        id, session_id, user_id, guest_share_id, device_id, device_name,
        protocol, connection_method, client_ip, user_agent, started_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
    `).run(
      id,
      params.sessionId,
      params.userId || null,
      params.guestShareId || null,
      params.deviceId,
      params.deviceName,
      params.protocol,
      params.connectionMethod,
      params.clientIp || null,
      params.userAgent || null,
      now
    );

    return id;
  }

  /**
   * End or update session log
   */
  static endSession(sessionId: string, status: 'closed' | 'failed' = 'closed', errorMessage?: string | null) {
    const now = new Date().toISOString();
    db.prepare(`
      UPDATE session_logs
      SET ended_at = ?, status = ?, error_message = ?
      WHERE session_id = ? AND status = 'active'
    `).run(now, status, errorMessage || null, sessionId);
  }

  /**
   * Admin: Query session logs with pagination and filters
   */
  static getSessionLogs(params?: {
    userId?: string;
    deviceId?: string;
    connectionMethod?: string;
    status?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }): { logs: SessionLogRecord[]; total: number } {
    const limit = params?.limit || 50;
    const offset = params?.offset || 0;

    let whereClause = '1=1';
    const queryParams: any[] = [];

    if (params?.userId) {
      whereClause += ' AND s.user_id = ?';
      queryParams.push(params.userId);
    }
    if (params?.deviceId) {
      whereClause += ' AND s.device_id = ?';
      queryParams.push(params.deviceId);
    }
    if (params?.connectionMethod) {
      whereClause += ' AND s.connection_method = ?';
      queryParams.push(params.connectionMethod);
    }
    if (params?.status) {
      whereClause += ' AND s.status = ?';
      queryParams.push(params.status);
    }
    if (params?.search) {
      whereClause += ' AND (s.device_name LIKE ? OR u.username LIKE ? OR u.display_name LIKE ? OR s.client_ip LIKE ?)';
      const searchWildcard = `%${params.search}%`;
      queryParams.push(searchWildcard, searchWildcard, searchWildcard, searchWildcard);
    }

    const countStmt = db.prepare(`
      SELECT COUNT(*) as count 
      FROM session_logs s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE ${whereClause}
    `);

    const total = (countStmt.get(...queryParams) as any).count;

    const selectStmt = db.prepare(`
      SELECT 
        s.*, u.username as user_username, u.display_name as user_display_name,
        CASE 
          WHEN s.ended_at IS NOT NULL 
          THEN ROUND((strftime('%s', s.ended_at) - strftime('%s', s.started_at)))
          ELSE ROUND((strftime('%s', 'now') - strftime('%s', s.started_at)))
        END as duration_seconds
      FROM session_logs s
      LEFT JOIN users u ON s.user_id = u.id
      WHERE ${whereClause}
      ORDER BY s.started_at DESC
      LIMIT ? OFFSET ?
    `);

    const logs = (selectStmt.all(...queryParams, limit, offset) as unknown) as SessionLogRecord[];

    return { logs, total };
  }

  /**
   * Get user's recent connections (top 5, most recent first)
   */
  static getUserRecentConnections(userId: string, limit = 5): any[] {
    const stmt = db.prepare(`
      SELECT 
        s.device_id, s.device_name, s.protocol, MAX(s.started_at) as last_connected_at,
        d.host, d.port, d.folder_id, f.name as folder_name, d.is_favorite
      FROM session_logs s
      LEFT JOIN devices d ON s.device_id = d.id
      LEFT JOIN folders f ON d.folder_id = f.id
      WHERE s.user_id = ? AND d.id IS NOT NULL
      GROUP BY s.device_id
      ORDER BY last_connected_at DESC
      LIMIT ?
    `);

    return stmt.all(userId, limit);
  }
}
