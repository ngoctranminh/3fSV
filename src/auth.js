import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { db, NOW, tx } from './db.js';

const COOKIE_NAME = 'warehouse_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const PASSWORD_KEY_LENGTH = 64;

const findUserByUsername = db.prepare(
  'SELECT id, username, password_salt, password_hash, role FROM users WHERE username = ?'
);
const findSession = db.prepare(`
  SELECT u.id, u.username, u.role
  FROM sessions s JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ? AND s.expires_at > ?
`);
const insertSession = db.prepare(
  'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
);
const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
const deleteExpiredSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function readCookie(req, name) {
  const cookies = req.headers.cookie?.split(';') ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf('=');
    if (separator === -1) continue;
    const key = cookie.slice(0, separator).trim();
    if (key === name) return decodeURIComponent(cookie.slice(separator + 1));
  }
  return null;
}

function validateAccount(username, password) {
  if (typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,50}$/.test(username)) {
    throw Object.assign(
      new Error('Tên tài khoản phải dài 3-50 ký tự và chỉ gồm chữ, số, ., _ hoặc -'),
      { status: 400 }
    );
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw Object.assign(new Error('Mật khẩu phải có ít nhất 8 ký tự'), { status: 400 });
  }
}

function createPasswordHash(password) {
  const salt = randomBytes(16).toString('hex');
  const passwordHash = scryptSync(password, salt, PASSWORD_KEY_LENGTH).toString('hex');
  return { salt, passwordHash };
}

export function createUser(username, password) {
  validateAccount(username, password);
  if (findUserByUsername.get(username)) {
    throw Object.assign(new Error('Tên tài khoản đã tồn tại'), { status: 409 });
  }

  const { salt, passwordHash } = createPasswordHash(password);
  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO users (username, password_salt, password_hash, role)
       VALUES (?, ?, ?, 'user')`
    )
    .run(username, salt, passwordHash);
  return { id: Number(lastInsertRowid), username, role: 'user' };
}

export function setUserPassword(username, password) {
  validateAccount(username, password);
  const { salt, passwordHash } = createPasswordHash(password);
  const existing = findUserByUsername.get(username);

  if (existing) {
    db.prepare(
      `UPDATE users
       SET username = ?, password_salt = ?, password_hash = ?, updated_at = ${NOW}
       WHERE id = ?`
    ).run(username, salt, passwordHash, existing.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(existing.id);
    return { id: existing.id, username, role: existing.role, created: false };
  }

  const { lastInsertRowid } = db
    .prepare('INSERT INTO users (username, password_salt, password_hash) VALUES (?, ?, ?)')
    .run(username, salt, passwordHash);
  return { id: Number(lastInsertRowid), username, role: 'user', created: true };
}

export function bootstrapUsersFromEnv() {
  const rawUsernames = process.env.BOOTSTRAP_USERNAMES;
  const password = process.env.BOOTSTRAP_PASSWORD;
  const adminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;

  if (!rawUsernames && !password && !adminUsername) return [];
  if (!rawUsernames || !password || !adminUsername) {
    throw new Error(
      'Phải đặt đủ BOOTSTRAP_USERNAMES, BOOTSTRAP_PASSWORD và BOOTSTRAP_ADMIN_USERNAME'
    );
  }

  // Chỉ bootstrap database hoàn toàn chưa có tài khoản, tránh đổi mật khẩu khi restart.
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0) return [];

  const usernames = [...new Set(rawUsernames.split(',').map((value) => value.trim()).filter(Boolean))];
  if (!usernames.some((username) => username.toLowerCase() === adminUsername.toLowerCase())) {
    throw new Error('BOOTSTRAP_ADMIN_USERNAME phải nằm trong BOOTSTRAP_USERNAMES');
  }

  return tx(() => {
    const users = usernames.map((username) => setUserPassword(username, password));
    const { changes } = db
      .prepare(`UPDATE users SET role = 'admin', updated_at = ${NOW} WHERE username = ?`)
      .run(adminUsername);
    if (changes !== 1) throw new Error('Không gán được tài khoản quản trị khi bootstrap');
    return users.map((user) => ({
      ...user,
      role: user.username.toLowerCase() === adminUsername.toLowerCase() ? 'admin' : 'user',
    }));
  });
}

export function verifyCredentials(username, password) {
  const user = findUserByUsername.get(username);
  if (!user || typeof password !== 'string') return null;

  const actual = scryptSync(password, user.password_salt, PASSWORD_KEY_LENGTH);
  const expected = Buffer.from(user.password_hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { id: user.id, username: user.username, role: user.role };
}

export function createSession(userId) {
  const now = Math.floor(Date.now() / 1000);
  deleteExpiredSessions.run(now);

  const token = randomBytes(32).toString('base64url');
  const expiresAt = now + SESSION_TTL_SECONDS;
  insertSession.run(hashToken(token), userId, expiresAt);
  return { token, expiresAt };
}

export function destroySession(req) {
  const token = readCookie(req, COOKIE_NAME);
  if (token) deleteSession.run(hashToken(token));
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(expiresAt * 1000),
    path: '/',
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

export function requireAuth(req, res, next) {
  const token = readCookie(req, COOKIE_NAME);
  const user = token
    ? findSession.get(hashToken(token), Math.floor(Date.now() / 1000))
    : null;

  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'Bạn cần đăng nhập' });
  }

  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Chỉ quản trị viên được thực hiện thao tác này' });
  }
  next();
}
