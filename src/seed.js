import { db } from './db.js';

const TREE = [
  {
    name: 'Đông lạnh',
    children: [
      {
        name: 'Mực',
        children: [
          { name: 'Chưa làm', qty: 8, unit: 'kg', price: 180000, min: 3 },
          { name: 'Đã làm', qty: 2.5, unit: 'kg', price: 220000, min: 3 },
        ],
      },
      { name: 'Seaweed', qty: 15, unit: 'gói', price: 25000, min: 5 },
      { name: 'Lươn', qty: 4, unit: 'kg', price: 320000, min: 2 },
      {
        name: 'Đùi gà',
        children: [
          { name: 'Chưa làm', qty: 12, unit: 'kg', price: 75000, min: 5 },
          { name: 'Gà bowl', qty: 6, unit: 'kg', price: 95000, min: 4 },
        ],
      },
      { name: 'Cá ibodai', qty: 7, unit: 'kg', price: 145000, min: 3 },
      {
        name: 'Bò',
        children: [
          {
            name: 'Đã làm',
            children: [
              { name: 'Bibimbap', qty: 1.2, unit: 'kg', price: 380000, min: 2 },
              { name: 'Bún bò', qty: 3.5, unit: 'kg', price: 350000, min: 2 },
            ],
          },
          {
            name: 'Chưa làm',
            children: [
              { name: 'Bibimbap', qty: 5, unit: 'kg', price: 340000, min: 2 },
              { name: 'Bún bò', qty: 4.5, unit: 'kg', price: 310000, min: 2 },
            ],
          },
        ],
      },
      { name: 'Gân bò', qty: 3, unit: 'kg', price: 240000, min: 2 },
      { name: 'Manduguk', qty: 20, unit: 'gói', price: 45000, min: 8 },
      {
        name: 'Trứng cá',
        children: [
          { name: 'Đỏ', qty: 1.5, unit: 'kg', price: 850000, min: 1 },
          { name: 'Xanh', qty: 0.8, unit: 'kg', price: 780000, min: 1 },
          { name: 'Đen', qty: 0.5, unit: 'kg', price: 1200000, min: 1 },
        ],
      },
      {
        name: 'Hoa quả ngâm, nấu sốt',
        children: [
          {
            name: 'Ngâm',
            children: [
              { name: 'Dừa', qty: 10, unit: 'hộp', price: 35000, min: 4 },
              { name: 'Mơ', qty: 8, unit: 'hộp', price: 42000, min: 4 },
            ],
          },
          {
            name: 'Nấu sốt',
            children: [{ name: 'Xoài', qty: 6, unit: 'hộp', price: 38000, min: 3 }],
          },
        ],
      },
      { name: 'Mochi', qty: 24, unit: 'gói', price: 55000, min: 10, expires: 20 },
      {
        name: 'Kem',
        children: [
          { name: 'Xanh', qty: 18, unit: 'hộp', price: 48000, min: 6 },
          { name: 'Đen', qty: 5, unit: 'hộp', price: 52000, min: 6 },
        ],
      },
      {
        name: 'Đậu',
        children: [
          { name: 'Không vỏ', qty: 14, unit: 'kg', price: 42000, min: 5 },
          { name: 'Có vỏ', qty: 9, unit: 'kg', price: 35000, min: 5 },
        ],
      },
      { name: 'Cua dự phòng', qty: 2, unit: 'kg', price: 650000, min: 1 },
      {
        name: 'Tôm',
        children: [
          { name: 'Không vỏ', qty: 6, unit: 'kg', price: 380000, min: 3 },
          { name: 'Có vỏ', qty: 8, unit: 'kg', price: 290000, min: 3 },
          { name: 'Đẹp', qty: 2.5, unit: 'kg', price: 520000, min: 3 },
        ],
      },
      { name: 'Nem', qty: 30, unit: 'gói', price: 65000, min: 10 },
      {
        name: 'Gyoza',
        children: [
          { name: 'Gà', qty: 16, unit: 'gói', price: 72000, min: 6 },
          { name: 'Lợn', qty: 12, unit: 'gói', price: 68000, min: 6 },
          { name: 'Bò', qty: 4, unit: 'gói', price: 85000, min: 6 },
          { name: 'Tofu', qty: 10, unit: 'gói', price: 58000, min: 6 },
        ],
      },
      {
        name: 'Tỏi, sả, ớt',
        children: [
          { name: 'Tỏi', qty: 5, unit: 'kg', price: 45000, min: 2 },
          { name: 'Sả', qty: 3, unit: 'kg', price: 30000, min: 2 },
          { name: 'Ớt', qty: 1.5, unit: 'kg', price: 65000, min: 2 },
        ],
      },
    ],
  },
  { name: 'Rau củ quả', qty: 25, unit: 'kg', price: 28000, min: 10, expires: 3 },
  {
    name: 'Vệ sinh',
    children: [
      { name: 'Tấm lót thớt', qty: 8, unit: 'cái', price: 35000, min: 3 },
      {
        name: 'Nùi',
        children: [
          { name: 'Sắt', qty: 12, unit: 'cái', price: 12000, min: 5 },
          { name: 'Nhôm', qty: 4, unit: 'cái', price: 15000, min: 5 },
        ],
      },
      {
        name: 'Giấy',
        children: [
          { name: 'Toilet', qty: 24, unit: 'cuộn', price: 8000, min: 10 },
          { name: 'Bếp', qty: 15, unit: 'cuộn', price: 22000, min: 6 },
          { name: 'Lau', qty: 30, unit: 'cuộn', price: 18000, min: 10 },
          { name: 'Lót bún', qty: 200, unit: 'tờ', price: 500, min: 50 },
        ],
      },
      { name: 'Nước tẩy trắng khăn', qty: 3, unit: 'chai', price: 65000, min: 2 },
      { name: 'Dầu rửa bát', qty: 6, unit: 'chai', price: 45000, min: 3 },
      { name: 'Nước lau nhà', qty: 2, unit: 'chai', price: 55000, min: 3 },
      { name: 'Hạt tẩy', qty: 4, unit: 'kg', price: 38000, min: 2 },
    ],
  },
];

const insert = db.prepare(`
  INSERT INTO items (parent_id, name, position, quantity, unit, unit_price, min_quantity, expires_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
          CASE WHEN ?8 IS NULL THEN NULL
               ELSE date('now', 'localtime', '+' || ?8 || ' days') END)
`);

const insertTx = db.prepare(`
  INSERT INTO transactions (item_id, kind, source, quantity, unit_price, note, occurred_at, document_id)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now', 'localtime', '-' || ? || ' days'), ?)
`);

const insertDocument = db.prepare(`
  INSERT INTO documents (code, type, subtype, party, total_value, note, created_by, occurred_at)
  VALUES (?, ?, ?, ?, ?, ?, 'Admin', datetime('now', 'localtime', '-' || ? || ' days'))
`);

const insertLine = db.prepare(`
  INSERT INTO document_lines (document_id, item_id, quantity, unit_price, note)
  VALUES (?, ?, ?, ?, '')
`);

const leaves = [];

function insertNodes(nodes, parentId) {
  nodes.forEach((node, index) => {
    const { lastInsertRowid } = insert.run(
      parentId,
      node.name,
      index,
      node.qty ?? 0,
      node.unit ?? '',
      node.price ?? 0,
      node.min ?? 0,
      node.expires ?? null
    );
    const id = Number(lastInsertRowid);
    if (node.children) insertNodes(node.children, id);
    else leaves.push({ id, ...node });
  });
}

const SUPPLIERS = ['Nhà cung cấp A', 'Nhà cung cấp B', 'Chợ đầu mối', 'Công ty thực phẩm Sài Gòn'];
const DESTINATIONS = ['Bếp chính', 'Quầy bar', 'Bếp phụ'];

// Sinh phiếu nhập/xuất rải trong 7 ngày qua, mỗi phiếu vài dòng hàng.
// Tồn kho trong TREE là tồn HIỆN TẠI nên các giao dịch này chỉ là lịch sử phát sinh,
// không cộng thêm vào items.quantity.
function seedDocuments() {
  let seed = 12345;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const counters = new Map();
  let documents = 0;
  let lines = 0;

  for (let daysAgo = 6; daysAgo >= 0; daysAgo -= 1) {
    const perDay = 2 + Math.floor(random() * 3);
    for (let n = 0; n < perDay; n += 1) {
      const isIn = random() < 0.5;
      const subtype = isIn ? 'purchase' : 'usage';
      const type = isIn ? 'in' : 'out';
      const prefix = isIn ? 'NK' : 'XK';

      const stamp = new Date(Date.now() - daysAgo * 86400000);
      const datePart =
        String(stamp.getFullYear()).slice(2) +
        String(stamp.getMonth() + 1).padStart(2, '0') +
        String(stamp.getDate()).padStart(2, '0');
      const key = `${prefix}${datePart}`;
      const seq = (counters.get(key) ?? 0) + 1;
      counters.set(key, seq);

      const lineCount = 1 + Math.floor(random() * 3);
      const picked = [];
      for (let k = 0; k < lineCount; k += 1) {
        const leaf = leaves[Math.floor(random() * leaves.length)];
        if (picked.some((entry) => entry.id === leaf.id)) continue;
        const quantity = Math.round(leaf.qty * (0.1 + random() * 0.2) * 10) / 10 || 1;
        picked.push({ id: leaf.id, quantity, price: leaf.price ?? 0 });
      }
      if (picked.length === 0) continue;

      const totalValue =
        Math.round(picked.reduce((sum, p) => sum + p.quantity * p.price, 0) * 100) / 100;

      const { lastInsertRowid } = insertDocument.run(
        `${key}-${String(seq).padStart(3, '0')}`,
        type,
        subtype,
        isIn
          ? SUPPLIERS[Math.floor(random() * SUPPLIERS.length)]
          : DESTINATIONS[Math.floor(random() * DESTINATIONS.length)],
        totalValue,
        '',
        daysAgo
      );
      const documentId = Number(lastInsertRowid);

      for (const entry of picked) {
        insertLine.run(documentId, entry.id, entry.quantity, entry.price);
        insertTx.run(
          entry.id,
          type,
          'manual',
          entry.quantity,
          entry.price,
          isIn ? 'Nhập hàng' : 'Xuất bếp',
          daysAgo,
          documentId
        );
        lines += 1;
      }
      documents += 1;
    }
  }
  return { documents, lines };
}

const { count } = db.prepare('SELECT COUNT(*) AS count FROM items').get();
if (count > 0 && !process.argv.includes('--force')) {
  console.log(`Đã có ${count} mục trong DB. Dùng "npm run seed -- --force" để xoá và nạp lại.`);
  process.exit(0);
}

db.exec('DELETE FROM transactions');
db.exec('DELETE FROM document_lines');
db.exec('DELETE FROM documents');
db.exec('DELETE FROM daily_snapshots');
db.exec('DELETE FROM items');
db.exec(
  "DELETE FROM sqlite_sequence WHERE name IN ('items', 'transactions', 'documents', 'document_lines')"
);
insertNodes(TREE, null);
const { documents, lines } = seedDocuments();

const { count: total } = db.prepare('SELECT COUNT(*) AS count FROM items').get();
const { value } = db
  .prepare('SELECT COALESCE(SUM(quantity * unit_price), 0) AS value FROM items')
  .get();
console.log(
  `Đã nạp ${total} mục vào kho, ${documents} phiếu (${lines} dòng hàng) trong 7 ngày qua.`
);
console.log(`Giá trị tồn kho: ${value.toLocaleString('vi-VN')} đ`);
