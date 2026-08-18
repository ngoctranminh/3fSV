import { Router } from 'express';
import { db, tx, NOW } from '../db.js';
import { DEFAULT_LOCALE, canonicalizeLocale, requestedLocale } from '../locale.js';
import { recordTransaction } from './transactions.js';

const router = Router();

const selectAll = db.prepare('SELECT * FROM items ORDER BY position, id');
const selectOne = db.prepare('SELECT * FROM items WHERE id = ?');
const selectAllTranslations = db.prepare(
  'SELECT item_id, locale, name, note FROM item_translations ORDER BY locale'
);
const selectTranslation = db.prepare(
  'SELECT name, note FROM item_translations WHERE item_id = ? AND locale = ?'
);
const insertItem = db.prepare(`
  INSERT INTO items (parent_id, name, quantity, unit, expires_at, note, position, unit_price, min_quantity)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const deleteItem = db.prepare('DELETE FROM items WHERE id = ?');
const nextPosition = db.prepare(
  'SELECT COALESCE(MAX(position) + 1, 0) AS pos FROM items WHERE parent_id IS ?'
);
const upsertTranslation = db.prepare(`
  INSERT INTO item_translations (item_id, locale, name, note)
  VALUES (?, ?, ?, ?)
  ON CONFLICT (item_id, locale) DO UPDATE SET
    name = excluded.name,
    note = excluded.note,
    updated_at = ${NOW}
`);
const deleteTranslation = db.prepare(
  'DELETE FROM item_translations WHERE item_id = ? AND locale = ?'
);

function parseTranslations(body, { partial }) {
  if (body.translations === undefined) return null;
  if (
    body.translations === null ||
    typeof body.translations !== 'object' ||
    Array.isArray(body.translations)
  ) {
    throw Object.assign(new Error('"translations" phải là một object theo locale'), { status: 400 });
  }

  const changes = [];
  const locales = new Set();
  for (const [rawLocale, value] of Object.entries(body.translations)) {
    const locale = canonicalizeLocale(rawLocale, `translations.${rawLocale}`);
    if (locale === DEFAULT_LOCALE) {
      throw Object.assign(
        new Error(`Dùng "name" và "note" cho locale mặc định ${DEFAULT_LOCALE}`),
        { status: 400 }
      );
    }
    if (locales.has(locale)) {
      throw Object.assign(new Error(`Locale "${locale}" bị lặp trong "translations"`), {
        status: 400,
      });
    }
    locales.add(locale);

    if (value === null && partial) {
      changes.push({ locale, value: null });
      continue;
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw Object.assign(new Error(`Bản dịch "${locale}" phải là một object`), { status: 400 });
    }

    const fields = {};
    if (value.name !== undefined || !partial) {
      if (typeof value.name !== 'string' || !value.name.trim()) {
        throw Object.assign(new Error(`"translations.${locale}.name" là bắt buộc`), {
          status: 400,
        });
      }
      fields.name = value.name.trim();
    }
    if (value.note !== undefined) fields.note = String(value.note).trim();
    changes.push({ locale, value: fields });
  }
  return changes;
}

function applyTranslationChanges(itemId, changes) {
  if (!changes) return;
  for (const change of changes) {
    if (change.value === null) {
      deleteTranslation.run(itemId, change.locale);
      continue;
    }

    const existing = selectTranslation.get(itemId, change.locale);
    const name = change.value.name ?? existing?.name;
    if (!name) {
      throw Object.assign(new Error(`Bản dịch mới "${change.locale}" phải có "name"`), {
        status: 400,
      });
    }
    const note = change.value.note ?? existing?.note ?? '';
    upsertTranslation.run(itemId, change.locale, name, note);
  }
}

function formatRows(rows, locale = null) {
  const byItem = new Map();
  for (const translation of selectAllTranslations.all()) {
    let translations = byItem.get(translation.item_id);
    if (!translations) {
      translations = {};
      byItem.set(translation.item_id, translations);
    }
    translations[translation.locale] = {
      name: translation.name,
      note: translation.note,
    };
  }

  return rows.map((row) => {
    const translations = byItem.get(row.id) ?? {};
    const result = { ...row, translations };
    if (!locale) return result;

    result.default_name = row.name;
    result.default_note = row.note;
    const translation = translations[locale];
    if (translation) {
      result.name = translation.name;
      result.note = translation.note;
      result.resolved_locale = locale;
    } else {
      result.resolved_locale = DEFAULT_LOCALE;
    }
    return result;
  });
}

function formatOne(row, locale = null) {
  return formatRows([row], locale)[0];
}

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

router.get('/', (req, res, next) => {
  try {
    const rows = formatRows(selectAll.all(), requestedLocale(req));
    res.json(req.query.flat === '1' ? rows : buildTree(rows));
  } catch (err) {
    next(err);
  }
});

router.get('/expiring', (req, res, next) => {
  try {
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
    res.json(formatRows(rows, requestedLocale(req)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res, next) => {
  try {
    const item = selectOne.get(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'Mục không tồn tại' });
    const rows = formatRows(selectAll.all(), requestedLocale(req));
    const node = buildTree(rows).flatMap(function flatten(n) {
      return [n, ...n.children.flatMap(flatten)];
    }).find((n) => n.id === item.id);
    res.json(node);
  } catch (err) {
    next(err);
  }
});

router.post('/', (req, res, next) => {
  try {
    const body = req.body ?? {};
    const fields = parseFields(body, { partial: false });
    const translations = parseTranslations(body, { partial: false });
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
      applyTranslationChanges(newId, translations);
      if (quantity > 0) {
        recordTransaction({
          itemId: newId,
          delta: quantity,
          source: 'initial',
          unitPrice: unitPrice > 0 ? unitPrice : null,
          note: 'Tồn đầu',
          user: req.user,
        });
      }
      return newId;
    });

    res.status(201).json(formatOne(selectOne.get(id)));
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
    const translations = parseTranslations(body, { partial: true });

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
    if (keys.length === 0 && nextQuantity === undefined && translations === null) {
      return res.json(formatOne(existing));
    }

    tx(() => {
      if (keys.length > 0) {
        const assignments = keys.map((key) => `${key} = ?`).join(', ');
        db.prepare(`UPDATE items SET ${assignments}, updated_at = ${NOW} WHERE id = ?`)
          .run(...keys.map((key) => fields[key]), id);
      }
      applyTranslationChanges(id, translations);
      const delta = nextQuantity === undefined ? 0 : nextQuantity - existing.quantity;
      if (delta !== 0) {
        recordTransaction({
          itemId: id,
          delta,
          source: 'edit',
          note: 'Sửa số lượng trực tiếp',
          user: req.user,
        });
      }
    });

    res.json(formatOne(selectOne.get(id)));
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
          user: req.user,
        })
      );
    }

    res.json(formatOne(selectOne.get(id)));
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const item = selectOne.get(id);
  if (!item) return res.status(404).json({ error: 'Mục không tồn tại' });
  const response = formatOne(item);
  deleteItem.run(id);
  res.json(response);
});

export default router;
