import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.env.DB_PATH || join(rootDir, 'data', 'kho.db');

export const db = new DatabaseSync(dbPath);

db.exec('PRAGMA foreign_keys = ON');

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
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_items_parent ON items(parent_id)');
