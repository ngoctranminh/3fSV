import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

test('DB cũ có notifications.read được chuyển sang schema mới', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kho-migration-'));
  try {
    const file = join(dir, 'kho.db');
    // Dựng lại schema notifications đúng như bản đã chạy trên DB thật trước migration
    const old = new DatabaseSync(file);
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_salt TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT, updated_at TEXT);
      CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE, message TEXT NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}', read INTEGER NOT NULL DEFAULT 0, created_at TEXT);
      CREATE INDEX idx_notifications_read ON notifications(read);
      INSERT INTO notifications (message) VALUES ('cũ');
    `);
    old.close();

    process.env.DB_PATH = file;
    const { db, dbPath } = await import('../src/db.js');
    assert.equal(dbPath, file);

    const columns = db.prepare('PRAGMA table_info(notifications)').all().map((c) => c.name);
    assert.ok(!columns.includes('read'));
    assert.ok(db.prepare('PRAGMA table_info(items)').all().some((c) => c.name === 'archived_at'));
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(db.prepare('SELECT message FROM notifications').get().message, 'cũ');
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');

    const { backupDatabase } = await import('../src/maintenance.js');
    const backup = backupDatabase();
    assert.ok(backup.startsWith(join(dir, 'backups', 'kho-')));
    assert.equal(backupDatabase(), null, 'mỗi ngày chỉ backup một lần');
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
