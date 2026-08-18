import { Router } from 'express';
import { db, tx, signedDeltaSql, NOW } from '../db.js';

const router = Router();

const selectItem = db.prepare('SELECT * FROM items WHERE id = ?');
const selectOne = db.prepare(`
  SELECT t.*, i.name AS item_name, i.unit AS item_unit
  FROM transactions t JOIN items i ON i.id = t.item_id
  WHERE t.id = ?
`);
const insertTx = db.prepare(`
  INSERT INTO transactions
    (item_id, user_id, username, kind, source, quantity, unit_price, note, occurred_at, document_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, ${NOW}), ?)
`);
const deleteTx = db.prepare('DELETE FROM transactions WHERE id = ?');
const setQuantity = db.prepare(
  `UPDATE items SET quantity = ?, updated_at = ${NOW} WHERE id = ?`
);
const setQuantityAndPrice = db.prepare(
  `UPDATE items SET quantity = ?, unit_price = ?, updated_at = ${NOW} WHERE id = ?`
);

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function signedDelta(row) {
  return row.kind === 'in' ? row.quantity : -row.quantity;
}

// Dùng chung cho mọi đường ghi sổ: POST /api/transactions và 3 chỗ trong items.js.
// Gọi bên trong tx() — không tự mở transaction.
export function recordTransaction({
  itemId,
  delta,
  source = 'manual',
  unitPrice = null,
  note = '',
  occurredAt = null,
  documentId = null,
  user = null,
}) {
  const item = selectItem.get(itemId);
  if (!item) throw fail('Mục không tồn tại', 404);

  // Làm tròn để phép cộng dồn số thực không tích luỹ rác kiểu 0.20000000000000284
  const quantity = Math.round((item.quantity + delta) * 1e6) / 1e6;
  if (quantity < 0) {
    throw fail(
      `Không đủ số lượng: "${item.name}" chỉ còn ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`
    );
  }

  const kind = delta > 0 ? 'in' : 'out';
  const price = unitPrice === null ? item.unit_price : unitPrice;

  const { lastInsertRowid } = insertTx.run(
    itemId,
    user?.id ?? null,
    user?.username ?? null,
    kind,
    source,
    Math.abs(delta),
    price,
    note,
    occurredAt,
    documentId
  );

  // Giá vốn chỉ đổi khi nhập hàng có khai giá
  if (kind === 'in' && unitPrice !== null && unitPrice > 0) {
    setQuantityAndPrice.run(quantity, unitPrice, itemId);
  } else {
    setQuantity.run(quantity, itemId);
  }

  return Number(lastInsertRowid);
}

function parseQuantity(value) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw fail('"quantity" phải là số dương');
  }
  return quantity;
}

function parseKind(value) {
  if (value !== 'in' && value !== 'out') {
    throw fail('"kind" phải là "in" (nhập) hoặc "out" (xuất)');
  }
  return value;
}

function parseUnitPrice(value) {
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw fail('"unit_price" phải là số không âm');
  }
  return price;
}

function parseOccurredAt(value) {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(value)) {
    throw fail('"occurred_at" phải có dạng YYYY-MM-DD hoặc YYYY-MM-DD HH:MM:SS');
  }
  return value.replace('T', ' ');
}

router.get('/', (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limit) || limit <= 0) throw fail('"limit" phải là số nguyên dương');
    if (!Number.isInteger(offset) || offset < 0) throw fail('"offset" phải là số nguyên không âm');

    const conditions = [];
    const params = [];

    if (req.query.item_id !== undefined) {
      const itemId = Number(req.query.item_id);
      if (!Number.isInteger(itemId)) throw fail('"item_id" phải là số nguyên');
      conditions.push('t.item_id = ?');
      params.push(itemId);
    }
    if (req.query.kind !== undefined) {
      conditions.push('t.kind = ?');
      params.push(parseKind(req.query.kind));
    }
    if (req.query.source !== undefined) {
      conditions.push('t.source = ?');
      params.push(String(req.query.source));
    }
    if (req.query.user_id !== undefined) {
      const userId = Number(req.query.user_id);
      if (!Number.isInteger(userId)) throw fail('"user_id" phải là số nguyên');
      conditions.push('t.user_id = ?');
      params.push(userId);
    }
    if (req.query.username !== undefined) {
      const username = String(req.query.username).trim();
      if (!username) throw fail('"username" không được để trống');
      conditions.push('t.username = ? COLLATE NOCASE');
      params.push(username);
    }
    if (req.query.from !== undefined) {
      conditions.push('date(t.occurred_at) >= date(?)');
      params.push(parseOccurredAt(req.query.from));
    }
    if (req.query.to !== undefined) {
      conditions.push('date(t.occurred_at) <= date(?)');
      params.push(parseOccurredAt(req.query.to));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM transactions t ${where}`)
      .get(...params);

    const items = db
      .prepare(
        `SELECT t.*, i.name AS item_name, i.unit AS item_unit,
                ${signedDeltaSql('t.')} AS delta,
                ROUND(t.quantity * t.unit_price, 2) AS total_price
         FROM transactions t JOIN items i ON i.id = t.item_id
         ${where}
         ORDER BY t.occurred_at DESC, t.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset);

    res.json({ items, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const row = selectOne.get(Number(req.params.id));
    if (!row) throw fail('Giao dịch không tồn tại', 404);
    res.json(row);
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body ?? {};
    const itemId = Number(body.item_id);
    if (!Number.isInteger(itemId)) throw fail('"item_id" phải là số nguyên');

    const kind = parseKind(body.kind);
    const quantity = parseQuantity(body.quantity);
    const unitPrice = body.unit_price === undefined ? null : parseUnitPrice(body.unit_price);
    const occurredAt = body.occurred_at === undefined ? null : parseOccurredAt(body.occurred_at);
    const note = body.note === undefined ? '' : String(body.note).trim();

    const id = tx(() =>
      recordTransaction({
        itemId,
        delta: kind === 'in' ? quantity : -quantity,
        source: 'manual',
        unitPrice,
        note,
        occurredAt,
        user: req.user,
      })
    );

    res.status(201).json(selectOne.get(id));
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = selectOne.get(id);
    if (!existing) throw fail('Giao dịch không tồn tại', 404);

    const body = req.body ?? {};
    const kind = body.kind === undefined ? existing.kind : parseKind(body.kind);
    const quantity = body.quantity === undefined ? existing.quantity : parseQuantity(body.quantity);
    const unitPrice =
      body.unit_price === undefined ? existing.unit_price : parseUnitPrice(body.unit_price);
    const occurredAt =
      body.occurred_at === undefined ? existing.occurred_at : parseOccurredAt(body.occurred_at);
    const note = body.note === undefined ? existing.note : String(body.note).trim();

    const nextDelta = kind === 'in' ? quantity : -quantity;

    tx(() => {
      const item = selectItem.get(existing.item_id);
      const nextQuantity =
        Math.round((item.quantity - signedDelta(existing) + nextDelta) * 1e6) / 1e6;
      if (nextQuantity < 0) {
        throw fail(
          `Sửa giao dịch này sẽ làm tồn kho "${item.name}" xuống âm (${nextQuantity}). Hãy kiểm tra lại các giao dịch sau nó.`
        );
      }
      db.prepare(
        `UPDATE transactions
         SET kind = ?, quantity = ?, unit_price = ?, note = ?, occurred_at = ?
         WHERE id = ?`
      ).run(kind, quantity, unitPrice, note, occurredAt, id);
      setQuantity.run(nextQuantity, existing.item_id);
    });

    res.json(selectOne.get(id));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = selectOne.get(id);
    if (!existing) throw fail('Giao dịch không tồn tại', 404);

    tx(() => {
      const item = selectItem.get(existing.item_id);
      const nextQuantity = Math.round((item.quantity - signedDelta(existing)) * 1e6) / 1e6;
      // Không clamp như /adjust: clamp ở đây làm sổ ghi lệch khỏi tồn kho vĩnh viễn,
      // và biểu đồ suy ra từ sổ ghi nên sẽ sai mãi
      if (nextQuantity < 0) {
        throw fail(
          `Xoá giao dịch này sẽ làm tồn kho "${item.name}" xuống âm (${nextQuantity}). Hãy xoá các giao dịch phát sinh sau nó trước, hoặc dùng /undo để ghi giao dịch bù.`
        );
      }
      deleteTx.run(id);
      setQuantity.run(nextQuantity, existing.item_id);
    });

    res.json(existing);
  } catch (err) {
    next(err);
  }
});

router.post('/:id/undo', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = selectOne.get(id);
    if (!existing) throw fail('Giao dịch không tồn tại', 404);

    const newId = tx(() =>
      recordTransaction({
        itemId: existing.item_id,
        delta: -signedDelta(existing),
        source: 'manual',
        unitPrice: existing.unit_price,
        note: `Hoàn tác giao dịch #${id}`,
        user: req.user,
      })
    );

    res.status(201).json(selectOne.get(newId));
  } catch (err) {
    next(err);
  }
});

export default router;
