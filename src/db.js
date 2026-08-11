import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH || join(rootDir, 'data', 'kho.db');

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON');

// Mọi mốc thời gian dùng giờ địa phương (theo TZ của hệ điều hành, hiện là Europe/Prague).
// Biểu đồ phải nhóm theo ngày địa phương, và trộn UTC với localtime giữa các bảng
// làm lệch 1-2 giờ khiến so sánh ngày sai.
export const NOW = "datetime('now', 'localtime')";

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id  INTEGER REFERENCES items(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    quantity   REAL    NOT NULL DEFAULT 0,
    unit       TEXT    NOT NULL DEFAULT '',
    expires_at TEXT,
    note       TEXT    NOT NULL DEFAULT '',
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (${NOW}),
    updated_at TEXT    NOT NULL DEFAULT (${NOW})
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id)');

const itemColumns = new Set(
  db.prepare('PRAGMA table_info(items)').all().map((column) => column.name)
);
for (const [name, declaration] of [
  ['unit_price', 'REAL NOT NULL DEFAULT 0'],
  ['min_quantity', 'REAL NOT NULL DEFAULT 0'],
]) {
  if (!itemColumns.has(name)) db.exec(`ALTER TABLE items ADD COLUMN ${name} ${declaration}`);
}

// DB tạo trước khi thống nhất múi giờ có DEFAULT là UTC. CREATE TABLE IF NOT EXISTS không
// sửa được DEFAULT của bảng đã tồn tại, mà SQLite cũng không cho ALTER COLUMN, nên phải
// dựng lại bảng. Bỏ qua nếu schema đã đúng.
const storedItemsSql =
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'").get()?.sql ??
  '';
if (storedItemsSql.includes("datetime('now')")) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE items_migrated (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_id    INTEGER REFERENCES items(id) ON DELETE CASCADE,
        name         TEXT    NOT NULL,
        quantity     REAL    NOT NULL DEFAULT 0,
        unit         TEXT    NOT NULL DEFAULT '',
        expires_at   TEXT,
        note         TEXT    NOT NULL DEFAULT '',
        position     INTEGER NOT NULL DEFAULT 0,
        unit_price   REAL    NOT NULL DEFAULT 0,
        min_quantity REAL    NOT NULL DEFAULT 0,
        created_at   TEXT    NOT NULL DEFAULT (${NOW}),
        updated_at   TEXT    NOT NULL DEFAULT (${NOW})
      )
    `);
    db.exec(`
      INSERT INTO items_migrated
        (id, parent_id, name, quantity, unit, expires_at, note, position,
         unit_price, min_quantity, created_at, updated_at)
      SELECT id, parent_id, name, quantity, unit, expires_at, note, position,
             unit_price, min_quantity,
             datetime(created_at, 'localtime'), datetime(updated_at, 'localtime')
      FROM items
    `);
    db.exec('DROP TABLE items');
    db.exec('ALTER TABLE items_migrated RENAME TO items');
    db.exec('CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id)');
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length > 0) {
      throw new Error(`Migration múi giờ làm hỏng khoá ngoại: ${JSON.stringify(violations)}`);
    }
    db.exec('COMMIT');
    console.log('Đã chuyển mốc thời gian của bảng items sang giờ địa phương.');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

db.exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind        TEXT    NOT NULL CHECK (kind IN ('in', 'out')),
    source      TEXT    NOT NULL DEFAULT 'manual'
                        CHECK (source IN ('manual', 'adjust', 'edit', 'initial')),
    quantity    REAL    NOT NULL CHECK (quantity > 0),
    unit_price  REAL    NOT NULL DEFAULT 0,
    note        TEXT    NOT NULL DEFAULT '',
    occurred_at TEXT    NOT NULL DEFAULT (${NOW}),
    created_at  TEXT    NOT NULL DEFAULT (${NOW})
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_tx_item ON transactions(item_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_tx_occurred ON transactions(occurred_at)');

db.exec(`
  CREATE TABLE IF NOT EXISTS daily_snapshots (
    date            TEXT    PRIMARY KEY,
    total_value     REAL    NOT NULL,
    total_items     INTEGER NOT NULL,
    low_stock_count INTEGER NOT NULL,
    updated_at      TEXT    NOT NULL DEFAULT (${NOW})
  )
`);

// Phiếu là lớp nằm trên sổ cái transactions: một phiếu gồm nhiều dòng, mỗi dòng vẫn sinh
// một transaction nên biểu đồ và cảnh báo không cần biết gì về phiếu.
// type là chiều tồn kho THẬT, không theo tab hiển thị: "Trả hàng" nằm ở tab Nhập kho
// nhưng type='out' vì trả lại NCC là trừ kho.
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT    NOT NULL UNIQUE,
    type        TEXT    NOT NULL CHECK (type IN ('in', 'out')),
    subtype     TEXT    NOT NULL,
    party       TEXT    NOT NULL DEFAULT '',
    status      TEXT    NOT NULL DEFAULT 'completed'
                        CHECK (status IN ('completed', 'cancelled')),
    total_value REAL    NOT NULL DEFAULT 0,
    note        TEXT    NOT NULL DEFAULT '',
    created_by  TEXT    NOT NULL DEFAULT 'Admin',
    occurred_at TEXT    NOT NULL DEFAULT (${NOW}),
    created_at  TEXT    NOT NULL DEFAULT (${NOW})
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS document_lines (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    quantity    REAL    NOT NULL CHECK (quantity > 0),
    unit_price  REAL    NOT NULL DEFAULT 0,
    note        TEXT    NOT NULL DEFAULT ''
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_doc_occurred ON documents(occurred_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_doc_type ON documents(type)');
db.exec('CREATE INDEX IF NOT EXISTS idx_doc_lines_doc ON document_lines(document_id)');

// Không thêm 'document' vào CHECK của transactions.source: document_id IS NOT NULL đã đủ,
// và đổi CHECK bắt buộc dựng lại bảng vì ALTER TABLE ADD CONSTRAINT của SQLite im lặng
// không có tác dụng
const txColumns = new Set(
  db.prepare('PRAGMA table_info(transactions)').all().map((column) => column.name)
);
if (!txColumns.has('document_id')) {
  db.exec('ALTER TABLE transactions ADD COLUMN document_id INTEGER REFERENCES documents(id)');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_tx_document ON transactions(document_id)');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL COLLATE NOCASE UNIQUE,
    password_salt TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (${NOW}),
    updated_at    TEXT    NOT NULL DEFAULT (${NOW})
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (${NOW})
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');

// SQLite không có transaction lồng nhau nên tx() không được gọi bên trong tx()
export function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    // Nếu không có transaction nào đang mở, ROLLBACK sẽ throw và che mất lỗi gốc
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw err;
  }
}

// Cần prefix khi JOIN với items vì bảng đó cũng có cột quantity
export const signedDeltaSql = (prefix = '') =>
  `CASE ${prefix}kind WHEN 'in' THEN ${prefix}quantity ELSE -${prefix}quantity END`;
