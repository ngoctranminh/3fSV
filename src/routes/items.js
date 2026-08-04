import { Router } from 'express';
import { db, tx, NOW } from '../db.js';
import { recordTransaction } from './transactions.js';

const router = Router();

const selectAll = db.prepare('SELECT * FROM items ORDER BY position, id');
const selectOne = db.prepare('SELECT * FROM items WHERE id = ?');
const insertItem = db.prepare(`
  INSERT INTO items (parent_id, name, quantity, unit, expires_at, note, position, unit_price, min_quantity)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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

  for (const key of ['unit_price', 'min_quantity']) {
    if (body[key] === undefined) continue;
    const value = Number(body[key]);
    if (!Number.isFinite(value) || value < 0) {
      throw Object.assign(new Error(`"${key}" phải là số không âm`), { status: 400 });
    }
    fields[key] = value;
  }

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
         AND date(expires_at) <= date('now', 'localtime', '+' || ? || ' days')
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
    const quantity = fields.quantity ?? 0;
    const unitPrice = fields.unit_price ?? 0;

    const id = tx(() => {
      // Chèn với quantity 0 rồi ghi sổ tồn đầu, để recordTransaction không cộng dồn hai lần
      const { lastInsertRowid } = insertItem.run(
        parentId,
        fields.name,
        0,
        fields.unit ?? '',
        fields.expires_at ?? null,
        fields.note ?? '',
        pos,
        unitPrice,
        fields.min_quantity ?? 0
      );
      const newId = Number(lastInsertRowid);
      if (quantity > 0) {
        recordTransaction({
          itemId: newId,
          delta: quantity,
          source: 'initial',
          unitPrice: unitPrice > 0 ? unitPrice : null,
          note: 'Tồn đầu',
        });
      }
      return newId;
    });

    res.status(201).json(selectOne.get(id));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = selectOne.get(id);
    if (!existing) return res.status(404).json({ error: 'Mục không tồn tại' });

    const body = req.body ?? {};
    const fields = parseFields(body, { partial: true });

    // quantity không ghi trực tiếp: đi qua sổ giao dịch để biểu đồ không lệch
    const nextQuantity = fields.quantity;
    delete fields.quantity;

    if (body.parent_id !== undefined) {
      const parentId = resolveParent(body.parent_id);
      if (parentId === id || (parentId !== null && isDescendant(parentId, id))) {
        return res.status(400).json({ error: 'Không thể chuyển mục vào chính nó hoặc mục con' });
      }
      fields.parent_id = parentId;
      fields.position = nextPosition.get(parentId).pos;
    }

    const keys = Object.keys(fields);
    if (keys.length === 0 && nextQuantity === undefined) return res.json(existing);

    tx(() => {
      if (keys.length > 0) {
        const assignments = keys.map((key) => `${key} = ?`).join(', ');
        db.prepare(`UPDATE items SET ${assignments}, updated_at = ${NOW} WHERE id = ?`)
          .run(...keys.map((key) => fields[key]), id);
      }
      const delta = nextQuantity === undefined ? 0 : nextQuantity - existing.quantity;
      if (delta !== 0) {
        recordTransaction({
          itemId: id,
          delta,
          source: 'edit',
          note: 'Sửa số lượng trực tiếp',
        });
      }
    });

    res.json(selectOne.get(id));
  } catch (err) {
    next(err);
  }
});

router.post('/:id/adjust', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const item = selectOne.get(id);
    if (!item) return res.status(404).json({ error: 'Mục không tồn tại' });

    const delta = Number(req.body?.delta);
    if (!Number.isFinite(delta)) {
      return res.status(400).json({ error: '"delta" phải là số' });
    }

    // Clamp về 0 rồi ghi sổ delta THỰC TẾ đã áp dụng, không phải delta yêu cầu
    const applied = Math.max(0, item.quantity + delta) - item.quantity;
    if (applied !== 0) {
      tx(() =>
        recordTransaction({
          itemId: id,
          delta: applied,
          source: 'adjust',
          note: applied > 0 ? 'Thêm nhanh' : 'Bớt nhanh',
        })
      );
    }

    res.json(selectOne.get(id));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = selectOne.get(id);
  if (!item) return res.status(404).json({ error: 'Mục không tồn tại' });
  deleteItem.run(id);
  res.json(item);
});

export default router;
