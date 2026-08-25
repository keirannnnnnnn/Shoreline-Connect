import { Router } from 'express';
import { AuthService } from '../services/auth.service.js';
import { authenticateUser, AuthenticatedRequest } from '../middleware/auth.middleware.js';

const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const { token, user } = await AuthService.login(username, password);

    // Set secure HTTP-only cookie
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({ token, user });
  } catch (err: any) {
    console.error('[Auth Error]', err.message);
    res.status(401).json({ error: err.message || 'Authentication failed' });
  }
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

router.get('/me', authenticateUser, (req: AuthenticatedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthenticated' });
  const user = AuthService.getUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.get('/users', authenticateUser, (req, res) => {
  const users = AuthService.getAllUsers();
  res.json({ users });
});

export default router;
