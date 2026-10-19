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

// Chặn dò mật khẩu: tính số lần sai trong 15 phút theo tài khoản và theo IP.
// Lưu trong bộ nhớ nên restart server là reset, đủ cho một server duy nhất.
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_ACCOUNT = 5;
const MAX_FAILURES_PER_IP = 20;
const failures = new Map();

function recentFailures(key, now) {
  const recent = (failures.get(key) ?? []).filter((at) => now - at < FAILURE_WINDOW_MS);
  if (recent.length > 0) failures.set(key, recent);
  else failures.delete(key);
  return recent;
}

function sweepFailures(now) {
  for (const key of failures.keys()) recentFailures(key, now);
}

// Trả về số giây phải chờ nếu đang bị khoá, ngược lại null
function lockedFor(keys, now) {
  for (const [key, max] of keys) {
    const recent = recentFailures(key, now);
    if (recent.length >= max) return Math.ceil((recent[0] + FAILURE_WINDOW_MS - now) / 1000);
  }
  return null;
}

function recordFailure(keys, now) {
  // Kẻ dò có thể thử hàng nghìn tên khác nhau; dọn định kỳ để Map không phình mãi
  if (failures.size > 10000) sweepFailures(now);
  for (const [key] of keys) failures.set(key, [...recentFailures(key, now), now]);
}

function limiterKeys(req, username) {
  return [
    [`account:${username.toLowerCase()}`, MAX_FAILURES_PER_ACCOUNT],
    [`ip:${req.ip}`, MAX_FAILURES_PER_IP],
  ];
}

function rejectLocked(res, retryAfter) {
  res.set('Retry-After', String(retryAfter));
  return res.status(429).json({
    error: `Nhập sai quá nhiều lần. Hãy thử lại sau ${Math.ceil(retryAfter / 60)} phút.`,
  });
}

router.post('/register', requireAuth, requireAdmin, (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const user = createUser(username, req.body?.password);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = req.body?.password;
    const keys = limiterKeys(req, username);
    const retryAfter = lockedFor(keys, Date.now());
    if (retryAfter !== null) return rejectLocked(res, retryAfter);

    const user = await verifyCredentials(username, password);

    if (!user) {
      recordFailure(keys, Date.now());
      return res.status(401).json({ error: 'Tên tài khoản hoặc mật khẩu không đúng' });
    }

    failures.delete(keys[0][0]);
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

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const currentPassword = req.body?.current_password;
    const newPassword = req.body?.new_password;
    // Cùng bộ đếm với /login: phiên bị lộ cũng không được dùng để dò mật khẩu hiện tại
    const keys = limiterKeys(req, req.user.username);
    const retryAfter = lockedFor(keys, Date.now());
    if (retryAfter !== null) return rejectLocked(res, retryAfter);

    if (!(await verifyCredentials(req.user.username, currentPassword))) {
      recordFailure(keys, Date.now());
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
