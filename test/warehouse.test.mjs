import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

// db.js đọc DB_PATH lúc import, nên phải đặt trước khi import động.
// node --test chạy mỗi file trong một process riêng nên các file không đụng DB của nhau.
process.env.DB_PATH = ':memory:';
const { db, tx } = await import('../src/db.js');
const { createUser } = await import('../src/auth.js');
const notifications = await import('../src/notifications.js');
const { recordTransaction } = await import('../src/routes/transactions.js');
const { default: itemsRouter } = await import('../src/routes/items.js');
const { default: transactionsRouter } = await import('../src/routes/transactions.js');
const { default: documentsRouter } = await import('../src/routes/documents.js');
const { default: notificationsRouter } = await import('../src/routes/notifications.js');
const { default: authRouter } = await import('../src/routes/auth.js');
const { default: statsRouter } = await import('../src/routes/stats.js');

const admin = createUser('quantri', 'matkhau123');
db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(admin.id);
admin.role = 'admin';
const member = createUser('nguoinha', 'matkhau123');

const emitted = [];
notifications.init({
  on() {},
  emit: (_event, n) => emitted.push({ to: 'all', n }),
  to: (room) => ({ emit: (_event, n) => emitted.push({ to: room, n }) }),
});

// Đăng nhập giả: header X-User chọn tài khoản, để test không phải đi qua cookie
let server;
let base;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/auth', authRouter);
  app.use((req, res, next) => {
    req.user = req.get('X-User') === 'member' ? member : admin;
    next();
  });
  app.use('/items', itemsRouter);
  app.use('/transactions', transactionsRouter);
  app.use('/documents', documentsRouter);
  app.use('/notifications', notificationsRouter);
  app.use(statsRouter);
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

async function call(method, path, body, as = 'admin') {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-User': as },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function createItem(fields) {
  return Number(
    db.prepare('INSERT INTO items (name, quantity, unit, min_quantity, unit_price) VALUES (?, ?, ?, ?, ?)')
      .run(fields.name, fields.quantity ?? 0, fields.unit ?? 'kg', fields.min ?? 0, fields.price ?? 0)
      .lastInsertRowid
  );
}

// Ngày giờ địa phương lệch offset ngày so với hôm nay, theo đúng định dạng lưu trong DB
const localDay = (offset) =>
  db.prepare("SELECT date('now', 'localtime', ? || ' days') AS d").get(String(offset)).d;

const quantityOf = (id) => db.prepare('SELECT quantity FROM items WHERE id = ?').get(id).quantity;

test('thông báo chỉ phát sau COMMIT, ROLLBACK thì không phát', () => {
  const itemId = createItem({ name: 'Mực', quantity: 20, min: 10 });
  emitted.length = 0;

  assert.throws(() =>
    tx(() => {
      recordTransaction({ itemId, delta: -15 });
      recordTransaction({ itemId, delta: -999 });
    })
  );
  assert.equal(emitted.length, 0);
  assert.equal(quantityOf(itemId), 20);

  tx(() => recordTransaction({ itemId, delta: -15 }));
  assert.equal(emitted.length, 1);
});

test('chỉ báo khi vừa vượt xuống ngưỡng, không báo lại mỗi lần xuất', () => {
  const itemId = createItem({ name: 'Bò', quantity: 20, min: 10 });
  emitted.length = 0;

  tx(() => recordTransaction({ itemId, delta: -5 })); // 15: chưa tới ngưỡng
  tx(() => recordTransaction({ itemId, delta: -5 })); // 10: chạm ngưỡng (<=) -> báo
  tx(() => recordTransaction({ itemId, delta: -2 })); // 8: vẫn dưới ngưỡng -> không báo
  assert.equal(emitted.length, 1);
  assert.match(emitted[0].n.message, /Bò/);

  tx(() => recordTransaction({ itemId, delta: 10 })); // 18: nhập lại
  tx(() => recordTransaction({ itemId, delta: -9 })); // 9: xuống lại -> báo lần nữa
  assert.equal(emitted.length, 2);
});

test('xoá mục: chỉ admin, lưu trữ cả nhánh và giữ lịch sử giao dịch', async () => {
  const groupId = createItem({ name: 'Hải sản' });
  const childId = Number(
    db.prepare("INSERT INTO items (parent_id, name, unit, unit_price) VALUES (?, 'Tôm', 'kg', 100)")
      .run(groupId).lastInsertRowid
  );
  await call('POST', `/items/${childId}/adjust`, { delta: 3 });

  assert.equal((await call('DELETE', `/items/${groupId}`, undefined, 'member')).status, 403);
  assert.equal((await call('DELETE', `/items/${groupId}`)).status, 200);

  const tree = (await call('GET', '/items?flat=1')).body;
  assert.ok(!tree.some((item) => item.id === groupId || item.id === childId));
  assert.equal((await call('GET', `/items/${childId}`)).status, 404);

  // Giao dịch cũ vẫn còn, thêm một giao dịch xuất hết tồn để giá trị hôm nay về 0
  const history = db.prepare('SELECT kind, quantity, note FROM transactions WHERE item_id = ? ORDER BY id').all(childId);
  assert.deepEqual(history.map((row) => [row.kind, row.quantity]), [['in', 3], ['out', 3]]);
  assert.equal(history[1].note, 'Xoá mục');
  assert.equal(quantityOf(childId), 0);

  // Không ghi thêm giao dịch vào mục đã xoá
  assert.equal((await call('POST', '/transactions', { item_id: childId, kind: 'in', quantity: 1 })).status, 404);
});

test('giao dịch thuộc phiếu không sửa/xoá/hoàn tác lẻ được; huỷ phiếu chỉ admin', async () => {
  const itemId = createItem({ name: 'Gạo', quantity: 0 });
  const created = await call('POST', '/documents', {
    subtype: 'purchase',
    lines: [{ item_id: itemId, quantity: 5, unit_price: 20 }],
  });
  assert.equal(created.status, 201);
  const { id: txId } = db.prepare('SELECT id FROM transactions WHERE document_id = ?').get(created.body.id);

  assert.equal((await call('PATCH', `/transactions/${txId}`, { quantity: 1 })).status, 409);
  assert.equal((await call('DELETE', `/transactions/${txId}`)).status, 409);
  assert.equal((await call('POST', `/transactions/${txId}/undo`)).status, 409);
  assert.equal(quantityOf(itemId), 5);

  assert.equal((await call('POST', `/documents/${created.body.id}/cancel`, {}, 'member')).status, 403);
  assert.equal((await call('POST', `/documents/${created.body.id}/cancel`)).status, 200);
  assert.equal(quantityOf(itemId), 0);
});

test('dòng phiếu không khai giá lưu giá hiện tại của mục, cộng các dòng ra đúng tổng phiếu', async () => {
  const itemId = createItem({ name: 'Đường', quantity: 0, price: 30 });
  const created = await call('POST', '/documents', {
    subtype: 'purchase',
    lines: [
      { item_id: itemId, quantity: 2, unit_price: 50 },
      { item_id: itemId, quantity: 3 },
    ],
  });
  assert.equal(created.status, 201);

  // Dòng 1 khai giá 50 làm giá vốn thành 50, nên dòng 2 cũng phải tính 50 như giao dịch của nó
  const { lines } = created.body;
  assert.deepEqual(lines.map((line) => line.unit_price), [50, 50]);
  assert.deepEqual(lines.map((line) => line.total_price), [100, 150]);
  assert.equal(created.body.total_value, 250);
  const txPrices = db
    .prepare('SELECT unit_price FROM transactions WHERE document_id = ? ORDER BY id')
    .all(created.body.id)
    .map((row) => row.unit_price);
  assert.deepEqual(txPrices, [50, 50]);
});

test('không huỷ được phiếu có mục đã xoá', async () => {
  const itemId = createItem({ name: 'Muối', quantity: 0 });
  const created = await call('POST', '/documents', {
    subtype: 'purchase',
    lines: [{ item_id: itemId, quantity: 2 }],
  });
  await call('DELETE', `/items/${itemId}`);
  const res = await call('POST', `/documents/${created.body.id}/cancel`);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /đã bị xoá/);
});

test('trạng thái đã đọc tính riêng từng người, không đọc được thông báo của người khác', async () => {
  const shared = notifications.createNotification({ message: 'Chung' });
  const privateToAdmin = notifications.createNotification({ userId: admin.id, message: 'Riêng' });
  assert.equal(emitted.at(-1).to, `user:${admin.id}`);

  assert.equal((await call('PATCH', `/notifications/${shared.id}/read`)).body.read, true);
  const memberList = (await call('GET', '/notifications', undefined, 'member')).body;
  assert.equal(memberList.items.find((n) => n.id === shared.id).read, false);
  assert.ok(!memberList.items.some((n) => n.id === privateToAdmin.id));

  assert.equal((await call('PATCH', `/notifications/${privateToAdmin.id}/read`, undefined, 'member')).status, 404);
  assert.equal((await call('GET', '/notifications?limit=abc')).status, 400);
});

test('từ chối ngày không có thật thay vì lưu rồi làm mất khỏi bộ lọc ngày', async () => {
  const itemId = createItem({ name: 'Đường', quantity: 10 });
  const post = (occurred_at) =>
    call('POST', '/transactions', { item_id: itemId, kind: 'in', quantity: 1, occurred_at });

  assert.equal((await post('2026-13-45')).status, 400);
  assert.equal((await post('2026-02-31')).status, 400);
  assert.equal((await post('2026-02-28 25:00')).status, 400);
  const ok = await post('2026-02-28T10:30');
  assert.equal(ok.status, 201);
  assert.equal(ok.body.occurred_at, '2026-02-28 10:30');

  // Gửi null khi sửa thì giữ ngày cũ, không ghi NULL vào cột NOT NULL
  const patched = await call('PATCH', `/transactions/${ok.body.id}`, { occurred_at: null });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.occurred_at, '2026-02-28 10:30');

  assert.equal((await call('GET', '/transactions?from=2026-02-30')).status, 400);
  assert.equal((await call('PATCH', `/items/${itemId}`, { expires_at: '2026-02-30' })).status, 400);
  assert.equal((await call('PATCH', `/items/${itemId}`, { expires_at: '2028-02-29' })).status, 200);
});

test('đăng nhập sai 5 lần thì khoá tài khoản, kể cả mật khẩu đúng', async () => {
  createUser('khoathu', 'matkhau123');
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('POST', '/auth/login', { username: 'khoathu', password: 'sai-mat-khau' })).status, 401);
  }
  const locked = await call('POST', '/auth/login', { username: 'khoathu', password: 'matkhau123' });
  assert.equal(locked.status, 429);
  // Tài khoản khác không bị ảnh hưởng
  assert.equal((await call('POST', '/auth/login', { username: 'nguoinha', password: 'matkhau123' })).status, 200);
});

test('lọc theo ngày tính trọn ngày "to", kể cả giao dịch lúc 23:59:59', async () => {
  const itemId = createItem({ name: 'Bột chiên', quantity: 0 });
  const day = localDay(-10);
  const insert = db.prepare(
    "INSERT INTO transactions (item_id, kind, quantity, occurred_at) VALUES (?, 'in', 1, ?)"
  );
  for (const at of [`${localDay(-11)} 23:59:59`, day, `${day} 23:59:59`, `${localDay(-9)} 00:00`]) {
    insert.run(itemId, at);
  }

  const res = await call('GET', `/transactions?item_id=${itemId}&from=${day}&to=${day}`);
  assert.deepEqual(res.body.items.map((t) => t.occurred_at).sort(), [day, `${day} 23:59:59`]);
});

test('lọc phiếu "today" không lấy phiếu hôm qua hay ngày mai', async () => {
  const itemId = createItem({ name: 'Hành', quantity: 0 });
  const codes = [];
  for (const [offset, time] of [[-1, '23:59:59'], [0, '00:00'], [0, '23:59:59'], [1, '00:00']]) {
    const created = await call('POST', '/documents', {
      subtype: 'other_in',
      note: 'loc-hom-nay',
      occurred_at: `${localDay(offset)} ${time}`,
      lines: [{ item_id: itemId, quantity: 1 }],
    });
    codes.push(created.body.code);
  }
  const res = await call('GET', '/documents?period=today&q=loc-hom-nay');
  assert.deepEqual(res.body.items.map((d) => d.code).sort(), [codes[1], codes[2]].sort());
});

test('biểu đồ giá trị tính lùi đúng theo ngày, kể cả giao dịch ghi ngày tương lai', async () => {
  // Giá trị kho tính trên mọi mục, nên dọn dữ liệu của các test trước để số liệu chỉ còn mục này
  db.exec('DELETE FROM transactions; DELETE FROM daily_snapshots; UPDATE items SET archived_at = datetime()');
  const itemId = createItem({ name: 'Thịt', quantity: 6, price: 10 });
  const insert = db.prepare(
    'INSERT INTO transactions (item_id, kind, quantity, occurred_at) VALUES (?, ?, ?, ?)'
  );
  insert.run(itemId, 'in', 3, `${localDay(-2)} 23:59:59`);
  insert.run(itemId, 'in', 2, `${localDay(0)} 08:00`);
  insert.run(itemId, 'in', 1, localDay(3));

  const res = await call('GET', '/stats/value-history?days=4');
  assert.deepEqual(res.body, [
    { date: localDay(-3), value: 0 },
    { date: localDay(-2), value: 30 },
    { date: localDay(-1), value: 30 },
    { date: localDay(0), value: 50 },
  ]);
});

test('GET /items/:id trả đúng nhánh con kèm bản dịch, bỏ mục đã xoá', async () => {
  const parentId = createItem({ name: 'Rau' });
  const insertChild = db.prepare('INSERT INTO items (parent_id, name, position) VALUES (?, ?, ?)');
  const childId = Number(insertChild.run(parentId, 'Cải', 1).lastInsertRowid);
  const grandchildId = Number(insertChild.run(childId, 'Cải ngọt', 0).lastInsertRowid);
  const archivedId = Number(insertChild.run(parentId, 'Rau cũ', 0).lastInsertRowid);
  db.prepare('UPDATE items SET archived_at = datetime() WHERE id = ?').run(archivedId);
  db.prepare("INSERT INTO item_translations (item_id, locale, name) VALUES (?, 'en', 'Cabbage')").run(childId);

  const res = await call('GET', `/items/${parentId}`);
  assert.equal(res.body.id, parentId);
  assert.deepEqual(res.body.children.map((c) => c.id), [childId]);
  assert.deepEqual(res.body.children[0].translations, { en: { name: 'Cabbage', note: '' } });
  assert.deepEqual(res.body.children[0].children.map((c) => c.id), [grandchildId]);
  assert.equal((await call('GET', `/items/${archivedId}`)).status, 404);
});

test('dòng phiếu hiện đường dẫn đầy đủ từ gốc của mục', async () => {
  const rootId = createItem({ name: 'Hải sản' });
  const insertChild = db.prepare('INSERT INTO items (parent_id, name) VALUES (?, ?)');
  const midId = Number(insertChild.run(rootId, 'Mực').lastInsertRowid);
  const leafId = Number(insertChild.run(midId, 'Đã làm').lastInsertRowid);

  const created = await call('POST', '/documents', {
    subtype: 'purchase',
    lines: [{ item_id: leafId, quantity: 1 }, { item_id: rootId, quantity: 2 }],
  });
  assert.deepEqual(
    created.body.lines.map((line) => line.item_full_name),
    ['Hải sản / Mực / Đã làm', 'Hải sản']
  );
});

test('ảnh phiếu trả 304 khi chưa đổi, thay ảnh thì nhận bản mới', async () => {
  const { default: sharp } = await import('sharp');
  const itemId = createItem({ name: 'Ớt' });
  const created = await call('POST', '/documents', {
    subtype: 'other_in',
    lines: [{ item_id: itemId, quantity: 1 }],
  });
  const url = `${base}/documents/${created.body.id}/image`;
  const png = (color) =>
    sharp({ create: { width: 8, height: 8, channels: 3, background: color } }).png().toBuffer();
  const upload = async (color) =>
    fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: await png(color) });

  assert.equal((await upload('#ff0000')).status, 200);
  const first = await fetch(url);
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal(first.headers.get('cache-control'), 'private, no-cache');

  // fetch tự thêm "Cache-Control: no-cache" khi có If-None-Match, khiến server buộc phải trả
  // bản đầy đủ; dùng node:http để gửi đúng request xác minh lại như trình duyệt/app
  const { get } = await import('node:http');
  const revalidate = () =>
    new Promise((resolve, reject) => {
      get(url, { headers: { 'If-None-Match': etag } }, (res) => {
        let length = 0;
        res.on('data', (chunk) => (length += chunk.length));
        res.on('end', () => resolve({ status: res.statusCode, etag: res.headers.etag, length }));
      }).on('error', reject);
    });

  const revalidated = await revalidate();
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.length, 0);

  await upload('#0000ff');
  const replaced = await revalidate();
  assert.equal(replaced.status, 200);
  assert.notEqual(replaced.etag, etag);
});

test('dọn thông báo quá 90 ngày cùng trạng thái đã đọc, giữ thông báo mới', async () => {
  const insert = db.prepare(
    "INSERT INTO notifications (message, created_at) VALUES (?, datetime('now', 'localtime', ?))"
  );
  const oldId = Number(insert.run('cũ', '-91 days').lastInsertRowid);
  const recentId = Number(insert.run('mới', '-89 days').lastInsertRowid);
  db.prepare('INSERT INTO notification_reads (notification_id, user_id) VALUES (?, ?)').run(oldId, admin.id);

  assert.ok(notifications.pruneNotifications() >= 1);
  const remaining = db.prepare('SELECT id FROM notifications WHERE id IN (?, ?)').all(oldId, recentId);
  assert.deepEqual(remaining.map((row) => row.id), [recentId]);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS n FROM notification_reads WHERE notification_id = ?').get(oldId).n,
    0
  );
});

test('dọn phiên hết hạn, giữ phiên còn hạn', async () => {
  const { pruneExpiredSessions, createSession } = await import('../src/auth.js');
  const now = Math.floor(Date.now() / 1000);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run('het-han', member.id, now - 1);
  createSession(member.id);

  assert.equal(pruneExpiredSessions(), 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE token_hash = 'het-han'").get().n, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(member.id).n >= 1);
});
