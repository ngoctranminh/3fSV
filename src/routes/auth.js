import { Router } from 'express';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireAuth,
  setSessionCookie,
  verifyCredentials,
} from '../auth.js';

const router = Router();

router.post('/login', (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = req.body?.password;
    const user = verifyCredentials(username, password);

    if (!user) {
      return res.status(401).json({ error: 'Tên tài khoản hoặc mật khẩu không đúng' });
    }

    const session = createSession(user.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res, next) => {
  try {
    destroySession(req);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
