import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { SharingService } from '../services/sharing.service.js';
import { config } from '../config/env.js';

const router = Router();

/**
 * 1. INTERNAL USER-TO-USER SHARING (Requires Auth)
 */
router.post('/user', authenticateUser, (req: AuthenticatedRequest, res) => {
  try {
    const currentUserId = req.user!.userId;
    const { deviceId, targetUserId } = req.body;

    if (!deviceId || !targetUserId) {
      return res.status(400).json({ error: 'deviceId and targetUserId are required' });
    }

    const share = SharingService.shareDeviceWithUser(deviceId, targetUserId, currentUserId);
    res.status(201).json({ share });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/user/:id', authenticateUser, (req: AuthenticatedRequest, res) => {
  try {
    const currentUserId = req.user!.userId;
    SharingService.revokeUserShare(req.params.id, currentUserId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/device/:id', authenticateUser, (req: AuthenticatedRequest, res) => {
  try {
    const currentUserId = req.user!.userId;
    const shares = SharingService.getSharesForDevice(req.params.id, currentUserId);
    res.json({ shares });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * 2. GUEST SHARE LINKS (Authenticated user creates/manages them)
 */
router.post('/guest', authenticateUser, async (req: AuthenticatedRequest, res) => {
  try {
    const currentUserId = req.user!.userId;
    const { deviceId, durationMinutes, durationLabel, pin, maxUses } = req.body;

    if (!deviceId || !durationMinutes) {
      return res.status(400).json({ error: 'deviceId and durationMinutes are required' });
    }

    const share = await SharingService.createGuestShareLink({
      deviceId,
      currentUserId,
      durationMinutes: parseInt(durationMinutes, 10),
      durationLabel: durationLabel || `${durationMinutes} minutes`,
      pin: pin ? String(pin) : undefined,
      maxUses: maxUses ? parseInt(maxUses, 10) : undefined,
    });

    res.status(201).json({ share });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/guest/:id', authenticateUser, (req: AuthenticatedRequest, res) => {
  try {
    const currentUserId = req.user!.userId;
    SharingService.revokeGuestShare(req.params.id, currentUserId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/guest/my', authenticateUser, (req: AuthenticatedRequest, res) => {
  const currentUserId = req.user!.userId;
  const guestShares = SharingService.getUserGuestShares(currentUserId);
  res.json({ guestShares });
});

/**
 * 3. PUBLIC GUEST SHARE ACCESS (No Shoreline Connect account or AD auth required)
 */
router.get('/guest/public/:token', (req, res) => {
  const result = SharingService.getGuestShareByToken(req.params.token);
  if (!result.valid) {
    return res.status(400).json({
      valid: false,
      reason: result.reason,
      message: result.reason === 'expired' 
        ? 'This guest share link has expired.'
        : result.reason === 'revoked'
        ? 'This share link was revoked by the owner.'
        : result.reason === 'max_uses_reached'
        ? 'This guest link has reached its maximum connection limit.'
        : 'Invalid or non-existent share link.'
    });
  }

  res.json(result);
});

router.post('/guest/public/:token/verify', async (req, res) => {
  const { pin } = req.body;
  const token = req.params.token;

  const result = SharingService.getGuestShareByToken(token);
  if (!result.valid || !result.share) {
    return res.status(400).json({
      valid: false,
      reason: result.reason,
      error: 'This guest share link is no longer valid or has expired.'
    });
  }

  // Verify PIN if set
  if (result.share.hasPin) {
    const isValidPin = await SharingService.verifyGuestPin(token, pin);
    if (!isValidPin) {
      return res.status(401).json({ error: 'Incorrect PIN code' });
    }
  }

  // Increment usage count
  SharingService.recordGuestShareUse(result.share.id);

  // Issue tunnel token
  const tunnelToken = jwt.sign({
    type: 'tunnel',
    deviceId: result.share.deviceId,
    guestShareId: result.share.id,
    connectionMethod: 'guest_link',
    sessionId: `guest_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
  }, config.jwtSecret, { expiresIn: '2m' });

  res.json({
    token: tunnelToken,
    device: {
      id: result.share.deviceId,
      name: result.share.deviceName,
      protocol: result.share.protocol,
    }
  });
});

export default router;
