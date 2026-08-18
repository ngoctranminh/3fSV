import { Router } from 'express';
import {
  clearSessionCookie,
  createUser,
  createSession,
  destroySession,
  requireAuth,
  requireAdmin,
  setSessionCookie,
  setUserPassword,
  verifyCredentials,
} from '../auth.js';

const router = Router();

router.post('/register', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const user = createUser(username, req.body?.password);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

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

router.post('/change-password', requireAuth, (req, res, next) => {
  try {
    const currentPassword = req.body?.current_password;
    const newPassword = req.body?.new_password;

    if (!verifyCredentials(req.user.username, currentPassword)) {
      return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'Mật khẩu mới phải khác mật khẩu hiện tại' });
    }

    // setUserPassword thu hồi mọi phiên của tài khoản. Tạo lại đúng một phiên để
    // thiết bị đang đổi mật khẩu tiếp tục đăng nhập, còn các thiết bị khác bị thoát.
    setUserPassword(req.user.username, newPassword);
    const session = createSession(req.user.id);
    setSessionCookie(res, session.token, session.expiresAt);

    res.json({
      message: 'Đổi mật khẩu thành công',
      user: req.user,
    });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
