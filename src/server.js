import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import itemsRouter from './routes/items.js';
import transactionsRouter from './routes/transactions.js';
import statsRouter from './routes/stats.js';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
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

app.use('/api/items', itemsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api', statsRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
