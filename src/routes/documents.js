import { Router, raw } from 'express';
import { db, tx, NOW } from '../db.js';
import { recordTransaction } from './transactions.js';

const router = Router();

// type là chiều tồn kho thật, không phải tab hiển thị. "Trả hàng" nằm ở tab Nhập kho
// nhưng trả lại NCC là trừ kho nên type='out'.
const SUBTYPES = {
  purchase: { label: 'Nhập hàng', desc: 'Nhập từ NCC', type: 'in', tab: 'in' },
  return: { label: 'Trả hàng', desc: 'Trả lại NCC', type: 'out', tab: 'in' },
  other_in: { label: 'Nhập khác', desc: 'Nhập nội bộ', type: 'in', tab: 'in' },
  usage: { label: 'Xuất dùng', desc: 'Cho bếp, pha chế', type: 'out', tab: 'out' },
  waste: { label: 'Xuất huỷ', desc: 'Hỏng, hết hạn', type: 'out', tab: 'out' },
  other_out: { label: 'Xuất khác', desc: 'Xuất nội bộ', type: 'out', tab: 'out' },
};

const TYPE_LABELS = { in: 'Nhập kho', out: 'Xuất kho' };
const STATUS_LABELS = { completed: 'Hoàn thành', cancelled: 'Đã huỷ' };
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const selectDocument = db.prepare(`
  SELECT d.*, EXISTS(
    SELECT 1 FROM document_images image WHERE image.document_id = d.id
  ) AS has_image
  FROM documents d
  WHERE d.id = ?
`);
const selectLines = db.prepare(`
  WITH RECURSIVE path(id, trail) AS (
    SELECT id, name FROM items WHERE parent_id IS NULL
    UNION ALL
    SELECT i.id, p.trail || ' / ' || i.name FROM items i JOIN path p ON i.parent_id = p.id
  )
  SELECT l.*, i.name AS item_name, i.unit AS item_unit, path.trail AS item_full_name,
         ROUND(l.quantity * l.unit_price, 2) AS total_price
  FROM document_lines l
  JOIN items i ON i.id = l.item_id
  JOIN path ON path.id = l.item_id
  WHERE l.document_id = ?
  ORDER BY l.id
`);
const insertDocument = db.prepare(`
  INSERT INTO documents (code, type, subtype, party, total_value, note, created_by, occurred_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, ${NOW}))
`);
const insertLine = db.prepare(`
  INSERT INTO document_lines (document_id, item_id, quantity, unit_price, note)
  VALUES (?, ?, ?, ?, ?)
`);
const nextSequence = db.prepare(`
  SELECT COALESCE(MAX(CAST(substr(code, 10) AS INTEGER)), 0) + 1 AS seq
  FROM documents WHERE code LIKE ?
`);
const selectTxOfDocument = db.prepare('SELECT * FROM transactions WHERE document_id = ?');
const deleteTxOfDocument = db.prepare('DELETE FROM transactions WHERE document_id = ?');
const setItemQuantity = db.prepare(
  `UPDATE items SET quantity = ?, updated_at = ${NOW} WHERE id = ?`
);
const selectItem = db.prepare('SELECT * FROM items WHERE id = ?');
const selectImage = db.prepare('SELECT * FROM document_images WHERE document_id = ?');
const saveImage = db.prepare(`
  INSERT INTO document_images (document_id, file_name, mime_type, data)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(document_id) DO UPDATE SET
    file_name = excluded.file_name,
    mime_type = excluded.mime_type,
    data = excluded.data,
    created_at = ${NOW}
`);
const deleteImage = db.prepare('DELETE FROM document_images WHERE document_id = ?');

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function toVnDateTime(value) {
  const [date, time = ''] = value.split(' ');
  const [year, month, day] = date.split('-');
  return time ? `${day}/${month}/${year} ${time.slice(0, 5)}` : `${day}/${month}/${year}`;
}

function decorate(row) {
  const meta = SUBTYPES[row.subtype];
  return {
    ...row,
    type_label: TYPE_LABELS[row.type],
    subtype_label: meta ? meta.label : row.subtype,
    status_label: STATUS_LABELS[row.status],
    occurred_at_label: toVnDateTime(row.occurred_at),
    has_image: Boolean(row.has_image),
    image_url: row.has_image ? `/api/documents/${row.id}/image` : null,
  };
}

function cleanFileName(value, mimeType) {
  const fallback = `anh-phieu.${IMAGE_TYPES[mimeType]}`;
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') throw fail('"image_name" phải là chuỗi');
  const name = value.trim();
  if (!name || name.length > 255 || /[\r\n/\\]/.test(name)) {
    throw fail('"image_name" không hợp lệ');
  }
  return name;
}

function hasValidSignature(data, mimeType) {
  if (mimeType === 'image/jpeg') return data.length >= 3 && data.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimeType === 'image/png') return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === 'image/gif') return data.length >= 6 && ['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString('ascii'));
  if (mimeType === 'image/webp') return data.length >= 12 && data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP';
  return false;
}

function validateImage(data, mimeType, fileName) {
  if (!IMAGE_TYPES[mimeType]) {
    throw fail('Ảnh phải có định dạng JPEG, PNG, WebP hoặc GIF');
  }
  if (!Buffer.isBuffer(data) || data.length === 0) throw fail('Dữ liệu ảnh không được để trống');
  if (data.length > MAX_IMAGE_BYTES) throw fail('Ảnh không được lớn hơn 5 MB', 413);
  if (!hasValidSignature(data, mimeType)) throw fail('Nội dung ảnh không đúng với định dạng khai báo');
  return { data, mimeType, fileName: cleanFileName(fileName, mimeType) };
}

function parseDataUrl(value, fileName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw fail('"image" phải là data URL dạng base64');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (!match) throw fail('"image" phải có dạng data:image/jpeg;base64,...');
  const encoded = match[2].replace(/\s/g, '');
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw fail('Dữ liệu base64 của ảnh không hợp lệ');
  }
  return validateImage(Buffer.from(encoded, 'base64'), match[1].toLowerCase(), fileName);
}

function parseOccurredAt(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/.test(value)) {
    throw fail('"occurred_at" phải có dạng YYYY-MM-DD hoặc YYYY-MM-DD HH:MM:SS');
  }
  return value.replace('T', ' ');
}

// Người dùng gõ "100%" trong ô tìm kiếm sẽ khớp bừa nếu không thoát ký tự đại diện
function escapeLike(value) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function buildCode(type, occurredAt) {
  const prefix = type === 'in' ? 'NK' : 'XK';
  const date = (occurredAt ?? db.prepare(`SELECT ${NOW} AS now`).get().now).slice(2, 10);
  const stamp = date.replaceAll('-', '');
  const { seq } = nextSequence.get(`${prefix}${stamp}-%`);
  return `${prefix}${stamp}-${String(seq).padStart(3, '0')}`;
}

router.get('/types', (req, res) => {
  const groups = { in: [], out: [] };
  for (const [subtype, meta] of Object.entries(SUBTYPES)) {
    groups[meta.tab].push({ subtype, label: meta.label, desc: meta.desc, type: meta.type });
  }
  res.json(groups);
});

router.get('/parties', (req, res, next) => {
  try {
    const rows = db
      .prepare(
        `SELECT party, COUNT(*) AS count, MAX(occurred_at) AS last_used
         FROM documents WHERE party <> '' GROUP BY party
         ORDER BY last_used DESC`
      )
      .all();
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.get('/summary', (req, res, next) => {
  try {
    const period = req.query.period ?? 'today';
    const ranges = {
      today: "date(occurred_at) = date('now', 'localtime')",
      week: "date(occurred_at) >= date('now', 'localtime', '-6 days')",
      month: "date(occurred_at) >= date('now', 'localtime', 'start of month')",
      all: '1 = 1',
    };
    if (!ranges[period]) {
      throw fail('"period" phải là today, week, month hoặc all');
    }

    const rows = db
      .prepare(
        `SELECT type, COUNT(*) AS count, COALESCE(SUM(total_value), 0) AS total
         FROM documents
         WHERE status = 'completed' AND ${ranges[period]}
         GROUP BY type`
      )
      .all();

    const empty = { total: 0, count: 0 };
    const summary = { in: { ...empty }, out: { ...empty } };
    for (const row of rows) {
      summary[row.type] = { total: Math.round(row.total * 100) / 100, count: row.count };
    }

    res.json({
      ...summary,
      period,
      date: toVnDateTime(db.prepare(`SELECT date('now', 'localtime') AS d`).get().d),    });
  } catch (err) {
    next(err);
  }
});

router.get('/', (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const offset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limit) || limit <= 0) throw fail('"limit" phải là số nguyên dương');
    if (!Number.isInteger(offset) || offset < 0) throw fail('"offset" phải là số nguyên không âm');

    const conditions = [];
    const params = [];

    if (req.query.type !== undefined) {
      if (req.query.type !== 'in' && req.query.type !== 'out') {
        throw fail('"type" phải là "in" hoặc "out"');
      }
      conditions.push('d.type = ?');
      params.push(req.query.type);
    }
    if (req.query.subtype !== undefined) {
      if (!SUBTYPES[req.query.subtype]) {
        throw fail(`"subtype" không hợp lệ. Chọn một trong: ${Object.keys(SUBTYPES).join(', ')}`);
      }
      conditions.push('d.subtype = ?');
      params.push(req.query.subtype);
    }
    if (req.query.status !== undefined) {
      if (!STATUS_LABELS[req.query.status]) {
        throw fail('"status" phải là "completed" hoặc "cancelled"');
      }
      conditions.push('d.status = ?');
      params.push(req.query.status);
    }
    if (req.query.q) {
      const pattern = `%${escapeLike(String(req.query.q).trim())}%`;
      conditions.push(
        `(d.code LIKE ? ESCAPE '\\' OR d.party LIKE ? ESCAPE '\\' OR d.note LIKE ? ESCAPE '\\')`
      );
      params.push(pattern, pattern, pattern);
    }
    if (req.query.period !== undefined && req.query.period !== 'all') {
      const ranges = {
        today: "date(d.occurred_at) = date('now', 'localtime')",
        week: "date(d.occurred_at) >= date('now', 'localtime', '-6 days')",
        month: "date(d.occurred_at) >= date('now', 'localtime', 'start of month')",
      };
      if (!ranges[req.query.period]) {
        throw fail('"period" phải là today, week, month hoặc all');
      }
      conditions.push(ranges[req.query.period]);
    }
    if (req.query.from !== undefined) {
      conditions.push('date(d.occurred_at) >= date(?)');
      params.push(parseOccurredAt(req.query.from));
    }
    if (req.query.to !== undefined) {
      conditions.push('date(d.occurred_at) <= date(?)');
      params.push(parseOccurredAt(req.query.to));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { total } = db
      .prepare(`SELECT COUNT(*) AS total FROM documents d ${where}`)
      .get(...params);

    const items = db
      .prepare(
        `SELECT d.*,
                EXISTS(
                  SELECT 1 FROM document_images image WHERE image.document_id = d.id
                ) AS has_image,
                (SELECT COUNT(*) FROM document_lines l WHERE l.document_id = d.id) AS line_count
         FROM documents d ${where}
         ORDER BY d.occurred_at DESC, d.id DESC
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, offset)
      .map(decorate);

    res.json({ items, total, limit, offset });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/image', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw fail('Mã phiếu không hợp lệ');
    if (!selectDocument.get(id)) throw fail('Phiếu không tồn tại', 404);
    const image = selectImage.get(id);
    if (!image) throw fail('Phiếu chưa có ảnh', 404);

    const fileName = encodeURIComponent(image.file_name).replace(/'/g, '%27');
    const data = Buffer.from(image.data);
    res.set({
      'Content-Type': image.mime_type,
      'Content-Length': String(data.length),
      'Content-Disposition': `inline; filename*=UTF-8''${fileName}`,
      'Cache-Control': 'private, no-store',
    });
    res.send(data);
  } catch (err) {
    next(err);
  }
});

router.put('/:id/image', raw({ type: 'image/*', limit: MAX_IMAGE_BYTES }), (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw fail('Mã phiếu không hợp lệ');
    if (!selectDocument.get(id)) throw fail('Phiếu không tồn tại', 404);

    const mimeType = req.get('Content-Type')?.split(';', 1)[0].toLowerCase();
    const image = validateImage(
      Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
      mimeType,
      req.get('X-File-Name')
    );
    saveImage.run(id, image.fileName, image.mimeType, image.data);
    res.json(decorate(selectDocument.get(id)));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id/image', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) throw fail('Mã phiếu không hợp lệ');
    if (!selectDocument.get(id)) throw fail('Phiếu không tồn tại', 404);
    if (deleteImage.run(id).changes === 0) throw fail('Phiếu chưa có ảnh', 404);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const document = selectDocument.get(Number(req.params.id));
    if (!document) throw fail('Phiếu không tồn tại', 404);
    res.json({ ...decorate(document), lines: selectLines.all(document.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body ?? {};
    const meta = SUBTYPES[body.subtype];
    if (!meta) {
      throw fail(`"subtype" không hợp lệ. Chọn một trong: ${Object.keys(SUBTYPES).join(', ')}`);
    }

    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      throw fail('Phiếu phải có ít nhất một dòng hàng');
    }

    const lines = body.lines.map((line, index) => {
      const position = index + 1;
      const itemId = Number(line?.item_id);
      if (!Number.isInteger(itemId)) throw fail(`Dòng ${position}: "item_id" phải là số nguyên`);
      if (!selectItem.get(itemId)) throw fail(`Dòng ${position}: nguyên liệu không tồn tại`, 404);

      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw fail(`Dòng ${position}: "quantity" phải là số dương`);
      }

      const unitPrice = line.unit_price === undefined ? null : Number(line.unit_price);
      if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
        throw fail(`Dòng ${position}: "unit_price" phải là số không âm`);
      }

      return {
        itemId,
        quantity,
        unitPrice,
        note: line.note === undefined ? '' : String(line.note).trim(),
      };
    });

    const occurredAt = parseOccurredAt(body.occurred_at);
    const party = body.party === undefined ? '' : String(body.party).trim();
    const note = body.note === undefined ? '' : String(body.note).trim();
    // Luôn lấy từ phiên đăng nhập, không nhận tên do client tự khai.
    const createdBy = req.user.username;
    const image = parseDataUrl(body.image, body.image_name);

    const totalValue =
      Math.round(
        lines.reduce(
          (sum, line) =>
            sum + line.quantity * (line.unitPrice ?? selectItem.get(line.itemId).unit_price),
          0
        ) * 100
      ) / 100;

    // Cả phiếu trong một transaction: một dòng lỗi thì không còn phiếu nửa vời
    const id = tx(() => {
      const code = buildCode(meta.type, occurredAt);
      const { lastInsertRowid } = insertDocument.run(
        code,
        meta.type,
        body.subtype,
        party,
        totalValue,
        note,
        createdBy,
        occurredAt
      );
      const documentId = Number(lastInsertRowid);

      for (const line of lines) {
        insertLine.run(documentId, line.itemId, line.quantity, line.unitPrice ?? 0, line.note);
        recordTransaction({
          itemId: line.itemId,
          delta: meta.type === 'in' ? line.quantity : -line.quantity,
          source: 'manual',
          unitPrice: line.unitPrice,
          note: line.note || `${meta.label}${party ? ` — ${party}` : ''}`,
          occurredAt,
          documentId,
          user: req.user,
        });
      }
      if (image) saveImage.run(documentId, image.fileName, image.mimeType, image.data);
      return documentId;
    });

    const created = selectDocument.get(id);
    res.status(201).json({ ...decorate(created), lines: selectLines.all(id) });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/cancel', (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const document = selectDocument.get(id);
    if (!document) throw fail('Phiếu không tồn tại', 404);
    if (document.status === 'cancelled') throw fail('Phiếu này đã huỷ rồi');

    tx(() => {
      // Không clamp khi tồn xuống âm: clamp làm sổ ghi lệch khỏi tồn kho vĩnh viễn
      for (const transaction of selectTxOfDocument.all(id)) {
        const item = selectItem.get(transaction.item_id);
        const delta = transaction.kind === 'in' ? transaction.quantity : -transaction.quantity;
        const nextQuantity = Math.round((item.quantity - delta) * 1e6) / 1e6;
        if (nextQuantity < 0) {
          throw fail(
            `Huỷ phiếu này sẽ làm tồn kho "${item.name}" xuống âm (${nextQuantity}). Hãy huỷ các phiếu phát sinh sau nó trước.`
          );
        }
        setItemQuantity.run(nextQuantity, item.id);
      }
      deleteTxOfDocument.run(id);
      db.prepare("UPDATE documents SET status = 'cancelled' WHERE id = ?").run(id);
    });

    const cancelled = selectDocument.get(id);
    res.json({ ...decorate(cancelled), lines: selectLines.all(id) });
  } catch (err) {
    next(err);
  }
});

export default router;
