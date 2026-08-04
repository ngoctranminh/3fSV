import { db } from './db.js';

const TREE = [
  {
    name: 'Đông lạnh',
    children: [
      { name: 'Mực', children: [{ name: 'Chưa làm' }, { name: 'Đã làm' }] },
      { name: 'Seaweed' },
      { name: 'Lươn' },
      { name: 'Đùi gà', children: [{ name: 'Chưa làm' }, { name: 'Gà bowl' }] },
      { name: 'Cá ibodai' },
      {
        name: 'Bò',
        children: [
          { name: 'Đã làm', children: [{ name: 'Bibimbap' }, { name: 'Bún bò' }] },
          { name: 'Chưa làm', children: [{ name: 'Bibimbap' }, { name: 'Bún bò' }] },
        ],
      },
      { name: 'Gân bò' },
      { name: 'Manduguk' },
      { name: 'Trứng cá', children: [{ name: 'Đỏ' }, { name: 'Xanh' }, { name: 'Đen' }] },
      {
        name: 'Hoa quả ngâm, nấu sốt',
        children: [
          { name: 'Ngâm', children: [{ name: 'Dừa' }, { name: 'Mơ' }] },
          { name: 'Nấu sốt', children: [{ name: 'Xoài' }] },
        ],
      },
      { name: 'Mochi' },
      { name: 'Kem', children: [{ name: 'Xanh' }, { name: 'Đen' }] },
      { name: 'Đậu', children: [{ name: 'Không vỏ' }, { name: 'Có vỏ' }] },
      { name: 'Cua dự phòng' },
      { name: 'Tôm', children: [{ name: 'Không vỏ' }, { name: 'Có vỏ' }, { name: 'Đẹp' }] },
      { name: 'Nem' },
      {
        name: 'Gyoza',
        children: [{ name: 'Gà' }, { name: 'Lợn' }, { name: 'Bò' }, { name: 'Tofu' }],
      },
      { name: 'Tỏi, sả, ớt', children: [{ name: 'Tỏi' }, { name: 'Sả' }, { name: 'Ớt' }] },
    ],
  },
  { name: 'Rau củ quả' },
  {
    name: 'Vệ sinh',
    children: [
      { name: 'Tấm lót thớt' },
      { name: 'Nùi', children: [{ name: 'Sắt' }, { name: 'Nhôm' }] },
      {
        name: 'Giấy',
        children: [{ name: 'Toilet' }, { name: 'Bếp' }, { name: 'Lau' }, { name: 'Lót bún' }],
      },
      { name: 'Nước tẩy trắng khăn' },
      { name: 'Dầu rửa bát' },
      { name: 'Nước lau nhà' },
      { name: 'Hạt tẩy' },
    ],
  },
];

const insert = db.prepare(
  'INSERT INTO items (parent_id, name, position) VALUES (?, ?, ?)'
);

function insertNodes(nodes, parentId) {
  nodes.forEach((node, index) => {
    const { lastInsertRowid } = insert.run(parentId, node.name, index);
    if (node.children) insertNodes(node.children, Number(lastInsertRowid));
  });
}

const { count } = db.prepare('SELECT COUNT(*) AS count FROM items').get();
if (count > 0 && !process.argv.includes('--force')) {
  console.log(`Đã có ${count} mục trong DB. Dùng "npm run seed -- --force" để xoá và nạp lại.`);
  process.exit(0);
}

db.exec('DELETE FROM items');
db.exec("DELETE FROM sqlite_sequence WHERE name = 'items'");
insertNodes(TREE, null);

const { count: total } = db.prepare('SELECT COUNT(*) AS count FROM items').get();
console.log(`Đã nạp ${total} mục vào kho.`);
