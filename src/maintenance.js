import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { db, dbPath } from './db.js';
import { recordDailySnapshot } from './routes/stats.js';
import { pruneExpiredSessions } from './auth.js';
import { pruneNotifications } from './notifications.js';

const INTERVAL_MS = 60 * 60 * 1000;
const KEEP_BACKUPS = 14;

// Mỗi ngày một bản, giữ 14 ngày gần nhất. VACUUM INTO tạo bản sao nhất quán kể cả khi
// đang có WAL, khác với copy file kho.db bằng tay.
// Mặc định nằm cạnh DB, nên hỏng ổ đĩa là mất cả hai; đặt BACKUP_DIR sang thư mục được
// đồng bộ ra ngoài (iCloud Drive, ổ ngoài...) để có bản sao ở nơi khác.
export function backupDatabase() {
  if (dbPath === ':memory:') return null;

  const dir = process.env.BACKUP_DIR || join(dirname(dbPath), 'backups');
  mkdirSync(dir, { recursive: true });
  const prefix = basename(dbPath, extname(dbPath));
  const { today } = db.prepare("SELECT date('now', 'localtime') AS today").get();
  const file = join(dir, `${prefix}-${today}.db`);
  if (existsSync(file)) return null;

  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);

  // Tên theo YYYY-MM-DD nên sắp xếp chuỗi cũng là sắp xếp theo ngày
  const pattern = new RegExp(`^${prefix}-\\d{4}-\\d{2}-\\d{2}\\.db$`);
  const backups = readdirSync(dir).filter((name) => pattern.test(name)).sort();
  for (const old of backups.slice(0, -KEEP_BACKUPS)) unlinkSync(join(dir, old));
  return file;
}

// Mỗi việc chạy độc lập: một việc lỗi không được chặn các việc sau
function attempt(failMessage, fn) {
  try {
    fn();
  } catch (err) {
    console.error(failMessage, err);
  }
}

export function runMaintenance() {
  attempt('Không ghi được snapshot hằng ngày', recordDailySnapshot);
  attempt('Không backup được database', () => {
    const file = backupDatabase();
    if (file) console.log(`Đã backup database: ${file}`);
  });
  attempt('Không dọn được phiên hết hạn', () => {
    const removed = pruneExpiredSessions();
    if (removed > 0) console.log(`Đã xoá ${removed} phiên đăng nhập hết hạn`);
  });
  attempt('Không dọn được thông báo cũ', () => {
    const removed = pruneNotifications();
    if (removed > 0) console.log(`Đã xoá ${removed} thông báo cũ`);
  });
}

export function startMaintenance() {
  runMaintenance();
  setInterval(runMaintenance, INTERVAL_MS).unref();
}
