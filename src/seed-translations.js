import { seedDefaultItemTranslations } from './item-translations.js';

const { added, addedByLocale, matched, missing } = seedDefaultItemTranslations();
const localeSummary = Object.entries(addedByLocale)
  .map(([locale, count]) => `${locale}: ${count}`)
  .join(', ');
console.log(`Đã thêm ${added} bản dịch (${localeSummary}); khớp ${matched} đường dẫn item.`);
if (missing.length > 0) {
  console.log(`${missing.length} đường dẫn không có trong database hiện tại nên được bỏ qua.`);
}
