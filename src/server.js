import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { Server as IOServer } from 'socket.io';
import { bootstrapUsersFromEnv, requireAuth, userFromRequest } from './auth.js';
import { init as initNotifications } from './notifications.js';
import { startMaintenance } from './maintenance.js';
import { db } from './db.js';
import authRouter from './routes/auth.js';
import itemsRouter from './routes/items.js';
import transactionsRouter from './routes/transactions.js';
import documentsRouter from './routes/documents.js';
import statsRouter from './routes/stats.js';
import usersRouter from './routes/users.js';
import notificationsRouter from './routes/notifications.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const PORT = process.env.PORT || 3000;
const bootstrappedUsers = bootstrapUsersFromEnv();

// `tailscale serve` chạy trên cùng máy và chuyển tiếp request, nên chỉ tin
// X-Forwarded-For từ loopback để req.ip là IP thật (dùng cho giới hạn đăng nhập)
app.set('trust proxy', 'loopback');

if (bootstrappedUsers.length > 0) {
  console.log(`Đã khởi tạo ${bootstrappedUsers.length} tài khoản ban đầu.`);
}

// Ảnh phiếu có thể được gửi dưới dạng data URL trong JSON. 7 MB đủ cho ảnh 5 MB
// sau khi base64 tăng kích thước khoảng một phần ba.
app.use(express.json({ limit: '7mb' }));
app.use(express.static(join(rootDir, 'public')));

// Đặt sau express.static nên chỉ ghi log request API, không ghi file tĩnh
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    console.log(
      `[${timestamp}] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`
    );
  });
  next();
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.use('/api/auth', authRouter);
app.use('/api', requireAuth);
app.use('/api/users', usersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/items', itemsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/documents', documentsRouter);
app.use('/api', statsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  // Lỗi 500 là lỗi không lường trước (thường từ SQLite); message có thể lộ câu SQL
  // hay đường dẫn file nên chỉ ghi log, còn client nhận thông báo chung
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Lỗi máy chủ' : err.message });
});

// Tạo HTTP server để có thể gắn Socket.IO
const server = http.createServer(app);
const io = new IOServer(server);

// Thông báo chứa tên hàng và số tồn, nên socket phải đăng nhập như /api
io.use((socket, next) => {
  const user = userFromRequest(socket.request);
  if (!user) return next(new Error('Bạn cần đăng nhập'));
  socket.data.user = user;
  next();
});

initNotifications(io);

server.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
  startMaintenance();
});

// launchd/Ctrl+C gửi tín hiệu dừng: đóng DB đàng hoàng để SQLite gộp WAL vào kho.db
function shutdown(signal) {
  console.log(`Nhận ${signal}, đang dừng server...`);
  // io.close() đóng luôn HTTP server mà nó gắn vào
  io.close(() => {
    db.close();
    process.exit(0);
  });
  // Kết nối keep-alive có thể giữ server.close() mãi; quá 5 giây thì thoát luôn
  setTimeout(() => process.exit(0), 5000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
