export const DEFAULT_LOCALE = 'vi-VN';

export function canonicalizeLocale(value, label = 'locale') {
  if (typeof value !== 'string' || !value.trim()) {
    throw Object.assign(new Error(`"${label}" phải là mã locale hợp lệ`), { status: 400 });
  }
  try {
    return Intl.getCanonicalLocales(value.trim())[0];
  } catch {
    throw Object.assign(new Error(`"${label}" phải là mã locale BCP 47 hợp lệ`), { status: 400 });
  }
}

export function requestedLocale(req) {
  if (req.query.locale === undefined || req.query.locale === '') return null;
  return canonicalizeLocale(req.query.locale);
}
