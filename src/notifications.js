import { db, afterCommit } from './db.js';

let io = null;

const insertNotification = db.prepare(
  `INSERT INTO notifications (user_id, message, metadata) VALUES (?, ?, ?)`
);
const selectById = db.prepare('SELECT * FROM notifications WHERE id = ?');

// Người dùng thấy thông báo chung (user_id NULL) và thông báo của riêng mình.
// read tính theo người đang xem, không dùng chung giữa các tài khoản.
const visibleSql = `
  SELECT n.id, n.user_id, n.message, n.metadata, n.created_at,
         r.user_id IS NOT NULL AS read
  FROM notifications n
  LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = :userId
  WHERE (n.user_id IS NULL OR n.user_id = :userId)
`;
const selectVisible = db.prepare(
  `${visibleSql} ORDER BY n.created_at DESC, n.id DESC LIMIT :limit OFFSET :offset`
);
const selectVisibleOne = db.prepare(`${visibleSql} AND n.id = :id`);
const countVisible = db.prepare(
  'SELECT COUNT(*) AS total FROM notifications WHERE user_id IS NULL OR user_id = ?'
);
const insertRead = db.prepare(
  'INSERT OR IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)'
);

// Thông báo là tin nhắc tức thời (sắp hết hàng...), sau 90 ngày không còn giá trị mà bảng
// cứ phình mãi. notification_reads của chúng bị xoá theo nhờ ON DELETE CASCADE.
const RETENTION_DAYS = 90;
const deleteOld = db.prepare(
  "DELETE FROM notifications WHERE created_at < datetime('now', 'localtime', '-' || ? || ' days')"
);

function format(row) {
  return { ...row, metadata: JSON.parse(row.metadata), read: Boolean(row.read) };
}

export function init(socketIo) {
  io = socketIo;
  // Phòng riêng của mỗi tài khoản để thông báo có user_id không lộ sang người khác
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user.id}`);
  });
}

export function createNotification({ userId = null, message, metadata = {} }) {
  const meta = JSON.stringify(metadata);
  const { lastInsertRowid } = insertNotification.run(userId, message, meta);
  const notif = format({ ...selectById.get(lastInsertRowid), read: 0 });
  // Dòng thông báo nằm trong transaction của người gọi nên ROLLBACK sẽ xoá nó;
  // chỉ phát socket khi chắc chắn giao dịch đã được ghi
  afterCommit(() => {
    if (!io) return;
    if (userId === null) io.emit('notification', notif);
    else io.to(`user:${userId}`).emit('notification', notif);
  });
  return notif;
}

export function getNotifications(userId, limit = 50, offset = 0) {
  return {
    items: selectVisible.all({ userId, limit, offset }).map(format),
    total: countVisible.get(userId).total,
  };
}

// Trả null nếu thông báo không tồn tại hoặc thuộc về người khác
export function markRead(id, userId) {
  const row = selectVisibleOne.get({ userId, id });
  if (!row) return null;
  insertRead.run(id, userId);
  return format({ ...row, read: 1 });
}

// Gọi theo lịch từ maintenance.js; trả về số thông báo đã xoá
export function pruneNotifications() {
  return deleteOld.run(RETENTION_DAYS).changes;
}

export function clearAll() {
  db.exec('DELETE FROM notifications');
}

export default { init, createNotification, getNotifications, markRead };
