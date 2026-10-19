import { Router } from 'express';
import { db, signedDeltaSql } from '../db.js';
import { requestedLocale } from '../locale.js';

const router = Router();

const EXPIRING_DAYS = 7;

const selectTotals = db.prepare(`
  SELECT COUNT(*) AS total_items,
         COALESCE(SUM(quantity * unit_price), 0) AS total_value,
         COALESCE(SUM(min_quantity > 0 AND quantity <= min_quantity), 0) AS low_stock_count
  FROM items
  WHERE archived_at IS NULL
`);

const selectExpiringCounts = db.prepare(`
  SELECT COALESCE(SUM(date(expires_at) < date('now', 'localtime')), 0) AS overdue_count,
         COALESCE(SUM(date(expires_at) >= date('now', 'localtime')), 0) AS expiring_count
  FROM items
  WHERE archived_at IS NULL
    AND expires_at IS NOT NULL
    AND date(expires_at) <= date('now', 'localtime', '+' || ? || ' days')
`);

const upsertSnapshot = db.prepare(`
  INSERT INTO daily_snapshots (date, total_value, total_items, low_stock_count)
  VALUES (date('now', 'localtime'), ?, ?, ?)
  ON CONFLICT(date) DO UPDATE
    SET total_value = excluded.total_value,
        total_items = excluded.total_items,
        low_stock_count = excluded.low_stock_count,
        updated_at = datetime('now', 'localtime')
`);

// Tên mục lá thường trùng nhau ("Đã làm" có ở cả Mực và Bò) nên trả kèm đường dẫn cha
const selectAlerts = db.prepare(`
  WITH RECURSIVE path(id, name, trail) AS (
    SELECT i.id, COALESCE(t.name, i.name), COALESCE(t.name, i.name)
    FROM items i
    LEFT JOIN item_translations t ON t.item_id = i.id AND t.locale = ?
    WHERE i.parent_id IS NULL
    UNION ALL
    SELECT i.id, COALESCE(t.name, i.name), p.trail || ' / ' || COALESCE(t.name, i.name)
    FROM items i
    JOIN path p ON i.parent_id = p.id
    LEFT JOIN item_translations t ON t.item_id = i.id AND t.locale = ?
  )
  SELECT i.id, path.name, i.quantity, i.unit, i.min_quantity, i.expires_at, i.updated_at,
         path.trail AS full_name,
         CASE
           WHEN i.expires_at IS NOT NULL AND date(i.expires_at) < date('now', 'localtime') THEN 'expired'
           WHEN i.min_quantity > 0 AND i.quantity <= i.min_quantity THEN 'low_stock'
           ELSE 'expiring'
         END AS kind
  FROM items i JOIN path ON path.id = i.id
  WHERE i.archived_at IS NULL
    AND ((i.min_quantity > 0 AND i.quantity <= i.min_quantity)
      OR (i.expires_at IS NOT NULL
          AND date(i.expires_at) <= date('now', 'localtime', '+' || ? || ' days')))
`);

const selectAlertCount = db.prepare(`
  SELECT COUNT(*) AS alert_count FROM items
  WHERE archived_at IS NULL
    AND ((min_quantity > 0 AND quantity <= min_quantity)
      OR (expires_at IS NOT NULL
          AND date(expires_at) <= date('now', 'localtime', '+' || ? || ' days')))
`);

// Ngày nào có snapshot thì đọc snapshot, ngày nào không thì tính lùi từ tồn kho hiện tại:
// giá trị cuối ngày d = giá trị hiện tại - tổng biến động của mọi giao dịch sau ngày d.
// Gom biến động theo ngày một lần rồi cộng dồn bằng window function, thay vì mỗi ngày quét
// lại cả bảng transactions (365 ngày là 365 lần quét). Giao dịch ghi ngày sau hôm nay
// không nằm trong days nên cộng riêng qua later.
const selectHistory = db.prepare(`
  WITH RECURSIVE days(d) AS (
    SELECT date('now', 'localtime', '-' || :offset || ' days')
    UNION ALL
    SELECT date(d, '+1 day') FROM days WHERE d < date('now', 'localtime')
  ),
  daily(d, delta) AS (
    SELECT date(t.occurred_at), SUM(${signedDeltaSql('t.')} * i.unit_price)
    FROM transactions t JOIN items i ON i.id = t.item_id
    -- So chuỗi để dùng idx_tx_occurred; ngày đầu tiên không cần biến động của chính nó
    WHERE t.occurred_at >= date('now', 'localtime', '-' || :offset || ' days', '+1 day')
    GROUP BY 1
  ),
  later(delta) AS (
    SELECT COALESCE(SUM(delta), 0) FROM daily WHERE d > date('now', 'localtime')
  )
  SELECT days.d AS date,
         s.total_value AS snapshot_value,
         days.d = date('now', 'localtime') AS is_today,
         (SELECT delta FROM later) + COALESCE(SUM(daily.delta) OVER (
           ORDER BY days.d DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS future_delta
  FROM days
  LEFT JOIN daily ON daily.d = days.d
  LEFT JOIN daily_snapshots s ON s.date = days.d
  ORDER BY days.d
`);

// Gọi theo lịch (maintenance.js) thay vì trong GET /summary, để ngày không ai mở app
// vẫn có snapshot. Ghi đè trong ngày nên lần chạy cuối ngày là giá trị cuối ngày.
export function recordDailySnapshot() {
  const totals = selectTotals.get();
  upsertSnapshot.run(totals.total_value, totals.total_items, totals.low_stock_count);
}

function toVnDate(value) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

function formatQuantity(quantity, unit) {
  const rounded = Math.round(quantity * 100) / 100;
  return unit ? `${rounded} ${unit}` : String(rounded);
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${dateStr}T00:00:00`) - today) / 86400000);
}

function buildAlert(row) {
  if (row.kind === 'expired') {
    const overdue = -daysUntil(row.expires_at);
    return {
      ...row,
      severity: 3,
      label: `Quá hạn ${overdue} ngày`,
      date: toVnDate(row.expires_at),
      sort_key: row.expires_at,
    };
  }
  if (row.kind === 'low_stock') {
    return {
      ...row,
      severity: 2,
      label: `Sắp hết (${formatQuantity(row.quantity, row.unit)})`,
      date: toVnDate(row.updated_at),
      sort_key: row.updated_at,
    };
  }
  return {
    ...row,
    severity: 1,
    label: `Còn ${daysUntil(row.expires_at)} ngày`,
    date: toVnDate(row.expires_at),
    sort_key: row.expires_at,
  };
}

router.get('/summary', (req, res, next) => {
  try {
    const totals = selectTotals.get();
    const { overdue_count, expiring_count } = selectExpiringCounts.get(EXPIRING_DAYS);
    // Một mục có thể vừa sắp hết vừa sắp hết hạn, nên đếm số dòng thay vì cộng ba số
    const { alert_count } = selectAlertCount.get(EXPIRING_DAYS);

    res.json({
      ...totals,
      expiring_count,
      overdue_count,
      alert_count,
    });
  } catch (err) {
    next(err);
  }
});

// Giá trị quá khứ quy theo unit_price hiện tại, không theo giá lúc phát sinh giao dịch:
// đây là "khối lượng tồn từng ngày tính theo giá hôm nay", không phải giá trị sổ sách lịch sử
router.get('/stats/value-history', (req, res, next) => {
  try {
    const days = Number(req.query.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return res.status(400).json({ error: '"days" phải là số nguyên từ 1 đến 365' });
    }

    const { total_value } = selectTotals.get();
    const rows = selectHistory.all({ offset: days - 1 });

    res.json(
      rows.map((row) => ({
        date: row.date,
        value:
          row.snapshot_value === null || row.is_today
            ? Math.round((total_value - row.future_delta) * 100) / 100
            : row.snapshot_value,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get('/alerts', (req, res, next) => {
  try {
    const locale = requestedLocale(req);
    const limit = req.query.limit === undefined ? null : Number(req.query.limit);
    if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
      return res.status(400).json({ error: '"limit" phải là số nguyên dương' });
    }

    const alerts = selectAlerts
      .all(locale, locale, EXPIRING_DAYS)
      .map(buildAlert)
      .sort((a, b) => b.severity - a.severity || a.sort_key.localeCompare(b.sort_key))
      .map(({ sort_key, ...alert }) => alert);

    res.json(limit === null ? alerts : alerts.slice(0, limit));
  } catch (err) {
    next(err);
  }
});

export default router;
