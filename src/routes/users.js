import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';

const router = Router();

router.use(requireAdmin);

router.get('/', (req, res, next) => {
  try {
    const users = db
      .prepare(
        `SELECT id, username, role, created_at, updated_at,
                (SELECT COUNT(*) FROM sessions s
                 WHERE s.user_id = users.id
                   AND s.expires_at > CAST(strftime('%s', 'now') AS INTEGER)) AS session_count
         FROM users ORDER BY role = 'admin' DESC, username COLLATE NOCASE`
      )
      .all();
    res.json({ users });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(400).json({ error: 'ID tài khoản không hợp lệ' });
    }
    if (id === req.user.id) {
      return res.status(400).json({ error: 'Bạn không thể tự xóa tài khoản đang đăng nhập' });
    }

    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'Tài khoản không tồn tại' });

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
});

export default router;
