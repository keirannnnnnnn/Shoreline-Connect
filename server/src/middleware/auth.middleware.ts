import { Request, Response, NextFunction } from 'express';
import { AuthService, JwtPayload } from '../services/auth.service.js';

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

export function authenticateUser(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token: string | undefined;

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please sign in.' });
  }

  try {
    const payload = AuthService.verifyToken(token);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
  }
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden: Administrator privileges required.' });
  }
  next();
}

/**
 * Enforce per-tab access based on Active Directory group configuration
 */
export function requireTabAccess(tabKey: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const permissions = AuthService.getUserPermissions(req.user.userId);
    const tabPerm = permissions.tabs[tabKey];

    if (!tabPerm || !tabPerm.canAccess) {
      return res.status(403).json({
        error: `Access denied: You do not have permission to access the '${tabKey}' feature. Active Directory group requirement not met.`,
        tab: tabKey,
        requiredGroup: tabPerm?.group || '',
      });
    }

    next();
  };
}

/**
 * Enforce per-tab admin requirement (Member of Tab Access Group AND Shoreline Admin Group)
 */
export function requireTabAdmin(tabKey: string) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required. Please sign in.' });
    }

    const permissions = AuthService.getUserPermissions(req.user.userId);
    const tabPerm = permissions.tabs[tabKey];

    if (!tabPerm || !tabPerm.canAccess || !tabPerm.isAdmin) {
      return res.status(403).json({
        error: `Access denied: Administrator privileges required for '${tabKey}'.`,
        tab: tabKey,
      });
    }

    next();
  };
}
