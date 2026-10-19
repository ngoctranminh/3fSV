export function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

// Regex thôi chưa đủ: "2026-13-45" khớp mẫu nhưng date() của SQLite trả NULL, nên giao dịch
// lưu với ngày đó biến mất khỏi mọi bộ lọc theo ngày; còn "2026-02-31" bị SQLite hiểu
// thành 03/03. Dựng lại bằng Date.UTC rồi so từng thành phần để loại cả hai trường hợp.
function isRealDateTime(value) {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) return false;
  const [year, month, day, hour = 0, minute = 0, second = 0] = match
    .slice(1)
    .map((part) => (part === undefined ? undefined : Number(part)));
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  );
}

// Trả null khi để trống (người gọi dùng giờ hiện tại), ngược lại trả "YYYY-MM-DD[ HH:MM[:SS]]"
export function parseOccurredAt(value, label = 'occurred_at') {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE_TIME_PATTERN.test(value)) {
    throw fail(`"${label}" phải có dạng YYYY-MM-DD hoặc YYYY-MM-DD HH:MM:SS`);
  }
  if (!isRealDateTime(value)) throw fail(`"${label}" không phải ngày giờ có thật`);
  return value.replace('T', ' ');
}

export function parseDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !isRealDateTime(value)) {
    throw fail(`"${label}" phải là ngày có thật dạng YYYY-MM-DD`);
  }
  return value;
}
