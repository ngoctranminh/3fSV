import { Router } from 'express';
import { getNotifications, markRead } from '../notifications.js';

const router = Router();

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

router.get('/', (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limit) || limit <= 0) throw fail('"limit" phải là số nguyên dương');
    if (!Number.isInteger(offset) || offset < 0) throw fail('"offset" phải là số nguyên không âm');

    const { items, total } = getNotifications(req.user.id, limit, offset);
    res.json({ items, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id/read', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw fail('ID thông báo không hợp lệ');
    const row = markRead(id, req.user.id);
    if (!row) throw fail('Thông báo không tồn tại', 404);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

export default router;
