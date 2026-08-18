import { db } from './db.js';

// Dùng đường dẫn đầy đủ vì nhiều nhánh có tên lá giống nhau nhưng nghĩa khác nhau,
// ví dụ "Không vỏ" của đậu và của tôm cần bản dịch tiếng Anh khác nhau.
const EN_US_NAMES = {
  'Đông lạnh': 'Frozen',
  'Đông lạnh / Mực': 'Squid',
  'Đông lạnh / Mực / Chưa làm': 'Unprepared',
  'Đông lạnh / Mực / Đã làm': 'Prepared',
  'Đông lạnh / Seaweed': 'Seaweed',
  'Đông lạnh / Lươn': 'Eel',
  'Đông lạnh / Đùi gà': 'Chicken thighs',
  'Đông lạnh / Đùi gà / Chưa làm': 'Unprepared',
  'Đông lạnh / Đùi gà / Gà bowl': 'Chicken bowl',
  'Đông lạnh / Cá ibodai': 'Ibodai fish',
  'Đông lạnh / Bò': 'Beef',
  'Đông lạnh / Bò / Đã làm': 'Prepared',
  'Đông lạnh / Bò / Đã làm / Bibimbap': 'Bibimbap',
  'Đông lạnh / Bò / Đã làm / Bún bò': 'Beef noodle soup',
  'Đông lạnh / Bò / Chưa làm': 'Unprepared',
  'Đông lạnh / Bò / Chưa làm / Bibimbap': 'Bibimbap',
  'Đông lạnh / Bò / Chưa làm / Bún bò': 'Beef noodle soup',
  'Đông lạnh / Gân bò': 'Beef tendon',
  'Đông lạnh / Manduguk': 'Manduguk',
  'Đông lạnh / Trứng cá': 'Fish roe',
  'Đông lạnh / Trứng cá / Đỏ': 'Red',
  'Đông lạnh / Trứng cá / Xanh': 'Green',
  'Đông lạnh / Trứng cá / Đen': 'Black',
  'Đông lạnh / Hoa quả ngâm, nấu sốt': 'Pickled fruit and cooked sauces',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Ngâm': 'Pickled',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Ngâm / Dừa': 'Coconut',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Ngâm / Mơ': 'Apricot',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Nấu sốt': 'Cooked sauce',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Nấu sốt / Xoài': 'Mango',
  'Đông lạnh / Mochi': 'Mochi',
  'Đông lạnh / Kem': 'Ice cream',
  'Đông lạnh / Kem / Xanh': 'Green',
  'Đông lạnh / Kem / Đen': 'Black',
  'Đông lạnh / Đậu': 'Beans',
  'Đông lạnh / Đậu / Không vỏ': 'Shelled',
  'Đông lạnh / Đậu / Có vỏ': 'Unshelled',
  'Đông lạnh / Cua dự phòng': 'Backup crab',
  'Đông lạnh / Tôm': 'Shrimp',
  'Đông lạnh / Tôm / Không vỏ': 'Peeled',
  'Đông lạnh / Tôm / Có vỏ': 'Shell-on',
  'Đông lạnh / Tôm / Đẹp': 'Premium',
  'Đông lạnh / Nem': 'Spring rolls',
  'Đông lạnh / Gyoza': 'Gyoza',
  'Đông lạnh / Gyoza / Gà': 'Chicken',
  'Đông lạnh / Gyoza / Lợn': 'Pork',
  'Đông lạnh / Gyoza / Bò': 'Beef',
  'Đông lạnh / Gyoza / Tofu': 'Tofu',
  'Đông lạnh / Tỏi, sả, ớt': 'Garlic, lemongrass and chili',
  'Đông lạnh / Tỏi, sả, ớt / Tỏi': 'Garlic',
  'Đông lạnh / Tỏi, sả, ớt / Sả': 'Lemongrass',
  'Đông lạnh / Tỏi, sả, ớt / Ớt': 'Chili',
  'Rau củ quả': 'Vegetables and fruit',
  'Vệ sinh': 'Cleaning supplies',
  'Vệ sinh / Tấm lót thớt': 'Cutting board mat',
  'Vệ sinh / Nùi': 'Scrubbers',
  'Vệ sinh / Nùi / Sắt': 'Steel',
  'Vệ sinh / Nùi / Nhôm': 'Aluminum',
  'Vệ sinh / Giấy': 'Paper products',
  'Vệ sinh / Giấy / Toilet': 'Toilet paper',
  'Vệ sinh / Giấy / Bếp': 'Kitchen paper',
  'Vệ sinh / Giấy / Lau': 'Cleaning paper',
  'Vệ sinh / Giấy / Lót bún': 'Noodle liners',
  'Vệ sinh / Nước tẩy trắng khăn': 'Cloth bleach',
  'Vệ sinh / Dầu rửa bát': 'Dishwashing liquid',
  'Vệ sinh / Nước lau nhà': 'Floor cleaner',
  'Vệ sinh / Hạt tẩy': 'Cleaning powder',
  'Nước Uống': 'Beverages',
  'Nước Uống / Cocacola': 'Coca-Cola',
  'Nước Uống / Cocacola zero': 'Coca-Cola Zero',
};

const CS_CZ_NAMES = {
  'Đông lạnh': 'Mražené potraviny',
  'Đông lạnh / Mực': 'Kalamáry',
  'Đông lạnh / Mực / Chưa làm': 'Nezpracované',
  'Đông lạnh / Mực / Đã làm': 'Zpracované',
  'Đông lạnh / Seaweed': 'Mořské řasy',
  'Đông lạnh / Lươn': 'Úhoř',
  'Đông lạnh / Đùi gà': 'Kuřecí stehna',
  'Đông lạnh / Đùi gà / Chưa làm': 'Nezpracované',
  'Đông lạnh / Đùi gà / Gà bowl': 'Kuřecí miska',
  'Đông lạnh / Cá ibodai': 'Ryba ibodai',
  'Đông lạnh / Bò': 'Hovězí maso',
  'Đông lạnh / Bò / Đã làm': 'Zpracované',
  'Đông lạnh / Bò / Đã làm / Bibimbap': 'Bibimbap',
  'Đông lạnh / Bò / Đã làm / Bún bò': 'Hovězí nudlová polévka',
  'Đông lạnh / Bò / Chưa làm': 'Nezpracované',
  'Đông lạnh / Bò / Chưa làm / Bibimbap': 'Bibimbap',
  'Đông lạnh / Bò / Chưa làm / Bún bò': 'Hovězí nudlová polévka',
  'Đông lạnh / Gân bò': 'Hovězí šlachy',
  'Đông lạnh / Manduguk': 'Manduguk',
  'Đông lạnh / Trứng cá': 'Rybí jikry',
  'Đông lạnh / Trứng cá / Đỏ': 'Červené',
  'Đông lạnh / Trứng cá / Xanh': 'Zelené',
  'Đông lạnh / Trứng cá / Đen': 'Černé',
  'Đông lạnh / Hoa quả ngâm, nấu sốt': 'Nakládané ovoce a vařené omáčky',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Ngâm': 'Nakládané',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Ngâm / Dừa': 'Kokos',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Ngâm / Mơ': 'Meruňka',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Nấu sốt': 'Vařená omáčka',
  'Đông lạnh / Hoa quả ngâm, nấu sốt / Nấu sốt / Xoài': 'Mango',
  'Đông lạnh / Mochi': 'Mochi',
  'Đông lạnh / Kem': 'Zmrzlina',
  'Đông lạnh / Kem / Xanh': 'Zelená',
  'Đông lạnh / Kem / Đen': 'Černá',
  'Đông lạnh / Đậu': 'Fazole',
  'Đông lạnh / Đậu / Không vỏ': 'Loupané',
  'Đông lạnh / Đậu / Có vỏ': 'Neloupané',
  'Đông lạnh / Cua dự phòng': 'Rezervní krab',
  'Đông lạnh / Tôm': 'Krevety',
  'Đông lạnh / Tôm / Không vỏ': 'Loupané',
  'Đông lạnh / Tôm / Có vỏ': 'Neloupané',
  'Đông lạnh / Tôm / Đẹp': 'Prémiové',
  'Đông lạnh / Nem': 'Jarní závitky',
  'Đông lạnh / Gyoza': 'Gyoza',
  'Đông lạnh / Gyoza / Gà': 'Kuřecí',
  'Đông lạnh / Gyoza / Lợn': 'Vepřové',
  'Đông lạnh / Gyoza / Bò': 'Hovězí',
  'Đông lạnh / Gyoza / Tofu': 'Tofu',
  'Đông lạnh / Tỏi, sả, ớt': 'Česnek, citronová tráva a chilli',
  'Đông lạnh / Tỏi, sả, ớt / Tỏi': 'Česnek',
  'Đông lạnh / Tỏi, sả, ớt / Sả': 'Citronová tráva',
  'Đông lạnh / Tỏi, sả, ớt / Ớt': 'Chilli',
  'Rau củ quả': 'Ovoce a zelenina',
  'Vệ sinh': 'Čisticí prostředky',
  'Vệ sinh / Tấm lót thớt': 'Podložka pod krájecí prkénko',
  'Vệ sinh / Nùi': 'Drátěnky',
  'Vệ sinh / Nùi / Sắt': 'Ocelové',
  'Vệ sinh / Nùi / Nhôm': 'Hliníkové',
  'Vệ sinh / Giấy': 'Papírové výrobky',
  'Vệ sinh / Giấy / Toilet': 'Toaletní papír',
  'Vệ sinh / Giấy / Bếp': 'Kuchyňské utěrky',
  'Vệ sinh / Giấy / Lau': 'Čisticí utěrky',
  'Vệ sinh / Giấy / Lót bún': 'Podložky pod nudle',
  'Vệ sinh / Nước tẩy trắng khăn': 'Bělidlo na utěrky',
  'Vệ sinh / Dầu rửa bát': 'Prostředek na mytí nádobí',
  'Vệ sinh / Nước lau nhà': 'Čisticí prostředek na podlahy',
  'Vệ sinh / Hạt tẩy': 'Čisticí prášek',
  'Nước Uống': 'Nápoje',
  'Nước Uống / Cocacola': 'Coca-Cola',
  'Nước Uống / Cocacola zero': 'Coca-Cola Zero',
};

const DEFAULT_TRANSLATIONS = Object.fromEntries(
  [...new Set([...Object.keys(EN_US_NAMES), ...Object.keys(CS_CZ_NAMES)])].map((path) => [
    path,
    {
      ...(EN_US_NAMES[path] ? { 'en-US': EN_US_NAMES[path] } : {}),
      ...(CS_CZ_NAMES[path] ? { 'cs-CZ': CS_CZ_NAMES[path] } : {}),
    },
  ])
);

export function seedDefaultItemTranslations() {
  const rows = db.prepare(`
    WITH RECURSIVE paths(id, path) AS (
      SELECT id, name FROM items WHERE parent_id IS NULL
      UNION ALL
      SELECT i.id, paths.path || ' / ' || i.name
      FROM items i JOIN paths ON i.parent_id = paths.id
    )
    SELECT id, path FROM paths
  `).all();
  const itemsByPath = new Map(rows.map((row) => [row.path, row.id]));
  const insert = db.prepare(`
    INSERT INTO item_translations (item_id, locale, name)
    VALUES (?, ?, ?)
    ON CONFLICT (item_id, locale) DO NOTHING
  `);

  let added = 0;
  const addedByLocale = {};
  const missing = [];
  for (const [path, translations] of Object.entries(DEFAULT_TRANSLATIONS)) {
    const itemId = itemsByPath.get(path);
    if (!itemId) {
      missing.push(path);
      continue;
    }
    for (const [locale, name] of Object.entries(translations)) {
      const changes = insert.run(itemId, locale, name).changes;
      added += changes;
      addedByLocale[locale] = (addedByLocale[locale] ?? 0) + changes;
    }
  }
  return {
    added,
    addedByLocale,
    missing,
    matched: Object.keys(DEFAULT_TRANSLATIONS).length - missing.length,
  };
}
