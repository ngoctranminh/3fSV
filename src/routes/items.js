import { Router } from 'express';
import { db } from '../db.js';

const router = Router();

const selectAll = db.prepare('SELECT * FROM items ORDER BY position, id');
const selectOne = db.prepare('SELECT * FROM items WHERE id = ?');
const insertItem = db.prepare(`
  INSERT INTO items (parent_id, name, quantity, unit, expires_at, note, position)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const deleteItem = db.prepare('DELETE FROM items WHERE id = ?');
const nextPosition = db.prepare(
  'SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM items WHERE parent_id IS ?'
);

function buildTree(rows) {
  const byId = new Map(rows.map((row) => [row.id, { ...row, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parent_id === null ? null : byId.get(node.parent_id);
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function isDescendant(candidateId, ancestorId) {
  let current = selectOne.get(candidateId);
  while (current && current.parent_id !== null) {
    if (current.parent_id === ancestorId) return true;
    current = selectOne.get(current.parent_id);
  }
  return false;
}

function parseFields(body, { partial }) {
  const fields = {};

  if (body.name !== undefined || !partial) {
    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw Object.assign(new Error('Trường "name" là bắt buộc'), { status: 400 });
    }
    fields.name = body.name.trim();
  }

  if (body.quantity !== undefined) {
    const quantity = Number(body.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw Object.assign(new Error('"quantity" phải là số không âm'), { status: 400 });
    }
    fields.quantity = quantity;
  }

  if (body.unit !== undefined) fields.unit = String(body.unit).trim();
  if (body.note !== undefined) fields.note = String(body.note).trim();

  if (body.expires_at !== undefined) {
    const value = body.expires_at;
    if (value === null || value === '') {
      fields.expires_at = null;
    } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      fields.expires_at = value;
    } else {
      throw Object.assign(new Error('"expires_at" phải có dạng YYYY-MM-DD'), { status: 400 });
    }
  }

  return fields;
}

function resolveParent(rawParentId) {
  if (rawParentId === undefined || rawParentId === null || rawParentId === '') return null;
  const parentId = Number(rawParentId);
  if (!Number.isInteger(parentId) || !selectOne.get(parentId)) {
    throw Object.assign(new Error('"parent_id" không tồn tại'), { status: 400 });
  }
  return parentId;
}

router.get('/', (req, res) => {
  const rows = selectAll.all();
  res.json(req.query.flat === '1' ? rows : buildTree(rows));
});

router.get('/expiring', (req, res) => {
  const days = Number(req.query.days ?? 7);
  if (!Number.isFinite(days) || days < 0) {
    return res.status(400).json({ error: '"days" phải là số không âm' });
  }
  const rows = db
    .prepare(
      `SELECT * FROM items
       WHERE expires_at IS NOT NULL
         AND date(expires_at) <= date('now', '+' || ? || ' days')
       ORDER BY expires_at`
    )
    .all(days);
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const item = selectOne.get(Number(req.params.id));
  if (!item) return res.status(404).json({ error: 'Mục không tồn tại' });
  const rows = selectAll.all();
  const node = buildTree(rows).flatMap(function flatten(n) {
    return [n, ...n.children.flatMap(flatten)];
  }).find((n) => n.id === item.id);
  res.json(node);
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body ?? {};
    const fields = parseFields(body, { partial: false });
    const parentId = resolveParent(body.parent_id);
    const { pos } = nextPosition.get(parentId);

    const { lastInsertRowid } = insertItem.run(
      parentId,
      fields.name,
      fields.quantity ?? 0,
      fields.unit ?? '',
      fields.expires_at ?? null,
      fields.note ?? '',
      pos
    );
    res.status(201).json(selectOne.get(Number(lastInsertRowid)));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!selectOne.get(id)) return res.status(404).json({ error: 'Mục không tồn tại' });

    const body = req.body ?? {};
    const fields = parseFields(body, { partial: true });

    if (body.parent_id !== undefined) {
      const parentId = resolveParent(body.parent_id);
      if (parentId === id || (parentId !== null && isDescendant(parentId, id))) {
        return res.status(400).json({ error: 'Không thể chuyển mục vào chính nó hoặc mục con' });
      }
      fields.parent_id = parentId;
      fields.position = nextPosition.get(parentId).pos;
    }

    const keys = Object.keys(fields);
    if (keys.length === 0) return res.json(selectOne.get(id));

    const assignments = keys.map((key) => `${key} = ?`).join(', ');
    db.prepare(`UPDATE items SET ${assignments}, updated_at = datetime('now') WHERE id = ?`)
      .run(...keys.map((key) => fields[key]), id);

    res.json(selectOne.get(id));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/adjust', (req, res) => {
  const id = Number(req.params.id);
  const item = selectOne.get(id);
  if (!item) return res.status(404).json({ error: 'Mục không tồn tại' });

  const delta = Number(req.body?.delta);
  if (!Number.isFinite(delta)) {
    return res.status(400).json({ error: '"delta" phải là số' });
  }

  const quantity = Math.max(0, item.quantity + delta);
  db.prepare("UPDATE items SET quantity = ?, updated_at = datetime('now') WHERE id = ?")
    .run(quantity, id);
  res.json(selectOne.get(id));
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = selectOne.get(id);
  if (!item) return res.status(404).json({ error: 'Mục không tồn tại' });
  deleteItem.run(id);
  res.json(item);
});

export default router;
