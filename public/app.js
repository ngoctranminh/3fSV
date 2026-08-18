const treeEl = document.getElementById('tree');
const emptyEl = document.getElementById('empty');
const alertsEl = document.getElementById('alerts');
const searchEl = document.getElementById('search');
const localeEl = document.getElementById('item-locale');
const dialog = document.getElementById('editor');
const form = document.getElementById('editor-form');
const translationsEl = document.getElementById('translations');
const DEFAULT_LOCALE = 'vi-VN';

let activeLocale = localStorage.getItem('item-locale') || DEFAULT_LOCALE;

function formField(name) {
  return form.elements.namedItem(name);
}

const collapsed = new Set(JSON.parse(localStorage.getItem('collapsed') || '[]'));
let tree = [];

function saveCollapsed() {
  localStorage.setItem('collapsed', JSON.stringify([...collapsed]));
}

function addTranslationRow(locale = '', translation = {}) {
  const row = el('div', { className: 'translation-row' }, [
    el('input', {
      className: 'translation-locale',
      value: locale,
      placeholder: 'en-US',
      title: 'Mã locale BCP 47, ví dụ en-US',
      required: true,
      autocomplete: 'off',
    }),
    el('input', {
      className: 'translation-name',
      value: translation.name || '',
      placeholder: 'Tên đã dịch',
      required: true,
      autocomplete: 'off',
    }),
    el('textarea', {
      className: 'translation-note',
      value: translation.note || '',
      placeholder: 'Ghi chú đã dịch',
      rows: 2,
    }),
  ]);
  const remove = el('button', {
    type: 'button',
    className: 'remove-translation',
    textContent: '✕',
    title: 'Xoá bản dịch',
  });
  remove.addEventListener('click', () => row.remove());
  row.append(remove);
  translationsEl.append(row);
}

function collectTranslations(item) {
  const translations = Object.fromEntries(
    Object.keys(item?.translations ?? {}).map((locale) => [locale, null])
  );
  const seen = new Set();

  for (const row of translationsEl.querySelectorAll('.translation-row')) {
    const rawLocale = row.querySelector('.translation-locale').value.trim();
    let locale;
    try {
      locale = Intl.getCanonicalLocales(rawLocale)[0];
    } catch {
      throw new Error(`Locale "${rawLocale}" không hợp lệ`);
    }
    if (!locale) throw new Error('Locale của bản dịch là bắt buộc');
    if (locale === DEFAULT_LOCALE) {
      throw new Error(`Hãy dùng trường mặc định cho ${DEFAULT_LOCALE}`);
    }
    if (seen.has(locale)) throw new Error(`Locale "${locale}" đang bị lặp`);
    seen.add(locale);
    translations[locale] = {
      name: row.querySelector('.translation-name').value,
      note: row.querySelector('.translation-note').value,
    };
  }
  return translations;
}

function syncLocaleOptions() {
  const locales = new Set([DEFAULT_LOCALE, activeLocale]);
  (function walk(nodes) {
    for (const node of nodes) {
      for (const locale of Object.keys(node.translations ?? {})) locales.add(locale);
      walk(node.children);
    }
  })(tree);

  localeEl.replaceChildren(
    ...[...locales].sort().map((locale) => el('option', {
      value: locale,
      textContent: locale === DEFAULT_LOCALE ? `Tên mặc định (${locale})` : locale,
    }))
  );
  localeEl.value = activeLocale;
}

async function api(path, options) {
  const res = await fetch(`/api/items${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (res.status === 401) {
    location.replace('/login.html');
    throw new Error('Bạn cần đăng nhập');
  }
  if (!res.ok) throw new Error(data.error || 'Lỗi không xác định');
  return data;
}

async function loadCurrentUser() {
  const res = await fetch('/api/auth/me');
  if (res.status === 401) {
    location.replace('/login.html');
    return false;
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Không lấy được tài khoản đăng nhập');
  document.getElementById('current-user').textContent = data.user.username;
  document.getElementById('manage-users').hidden = data.user.role !== 'admin';
  return true;
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(`${dateStr}T00:00:00`) - today) / 86400000);
}

function formatPrice(value) {
  return `${new Intl.NumberFormat(activeLocale, {
    maximumFractionDigits: 2,
  }).format(value)} Kč`;
}

function markContainers(nodes) {
  for (const node of nodes) {
    markContainers(node.children);
    // Chỉ nút có con mới là thư mục. Một sản phẩm vẫn có thể nằm ở cấp gốc
    // (ví dụ "Rau củ quả") và phải sửa được số lượng, đơn giá, ngưỡng cảnh báo.
    node.is_container = node.children.length > 0;
  }
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child) node.append(child);
  return node;
}

function renderNode(item, query) {
  const hasChildren = item.children.length > 0;
  const isContainer = item.is_container;
  const isCollapsed = collapsed.has(item.id);
  const matches = query && item.name.toLowerCase().includes(query);

  const twisty = el('button', {
    className: hasChildren ? 'twisty' : 'twisty leaf',
    textContent: isCollapsed ? '▶' : '▼',
    title: isCollapsed ? 'Mở' : 'Thu',
  });
  twisty.addEventListener('click', () => {
    if (!hasChildren) return;
    collapsed.has(item.id) ? collapsed.delete(item.id) : collapsed.add(item.id);
    saveCollapsed();
    render();
  });

  const parts = [twisty, el('span', { className: 'name', textContent: item.name })];

  if (!isContainer && (item.quantity > 0 || item.unit)) {
    parts.push(el('span', {
      className: item.quantity > 0 ? 'badge' : 'badge zero',
      textContent: `${item.quantity}${item.unit ? ` ${item.unit}` : ''}`,
    }));
  }

  if (!isContainer) {
    parts.push(el('span', {
      className: item.unit_price > 0 ? 'badge price' : 'badge price zero',
      textContent: `${formatPrice(item.unit_price)}${item.unit ? `/${item.unit}` : ''}`,
      title: 'Đơn giá',
    }));
  }

  if (!isContainer && item.expires_at) {
    const left = daysUntil(item.expires_at);
    parts.push(el('span', {
      className: left <= 7 ? 'badge date soon' : 'badge date',
      textContent: left < 0 ? `quá hạn ${-left}n` : `còn ${left}n`,
      title: `Hạn dùng ${item.expires_at}`,
    }));
  }

  if (item.note) parts.push(el('span', { className: 'note', textContent: item.note }));

  parts.push(el('div', { className: 'spacer' }));

  const ops = el('div', { className: 'ops' });
  const buttons = [];
  if (!isContainer) {
    buttons.push(
      ['−', 'Bớt 1', () => api(`/${item.id}/adjust`, { method: 'POST', body: JSON.stringify({ delta: -1 }) })],
      ['+', 'Thêm 1', () => api(`/${item.id}/adjust`, { method: 'POST', body: JSON.stringify({ delta: 1 }) })]
    );
  }
  buttons.push(
    ['＋mục', 'Thêm mục con', () => openEditor({ parentId: item.id })],
    ['Sửa', isContainer ? 'Sửa thư mục' : 'Sửa mục', () => openEditor({ item })]
  );
  for (const [label, title, action] of buttons) {
    const button = el('button', { textContent: label, title });
    button.addEventListener('click', () => run(action));
    ops.append(button);
  }

  const del = el('button', { className: 'del', textContent: '✕', title: 'Xoá mục' });
  del.addEventListener('click', () => {
    const warning = hasChildren ? `\n\nCả ${item.children.length} mục con cũng bị xoá.` : '';
    if (confirm(`Xoá "${item.name}"?${warning}`)) {
      run(() => api(`/${item.id}`, { method: 'DELETE' }));
    }
  });
  ops.append(del);
  parts.push(ops);

  const row = el('div', {
    className: `${matches ? 'node match' : 'node'}${isContainer ? ' container' : ''}`,
  }, parts);
  const li = el('li', { className: hasChildren && isCollapsed ? 'collapsed' : '' }, [row]);

  if (hasChildren) {
    li.append(el('ul', {}, item.children.map((child) => renderNode(child, query))));
  }
  return li;
}

function filterTree(nodes, query) {
  return nodes
    .map((node) => {
      const children = filterTree(node.children, query);
      const matches = node.name.toLowerCase().includes(query);
      return matches || children.length ? { ...node, children } : null;
    })
    .filter(Boolean);
}

function renderAlerts() {
  const flat = [];
  (function walk(nodes) {
    for (const node of nodes) {
      flat.push(node);
      walk(node.children);
    }
  })(tree);

  const soon = flat
    .filter((item) => !item.is_container && item.expires_at && daysUntil(item.expires_at) <= 7)
    .sort((a, b) => a.expires_at.localeCompare(b.expires_at));

  alertsEl.replaceChildren(
    ...soon.map((item) => {
      const left = daysUntil(item.expires_at);
      return el('div', {
        className: left < 0 ? 'alert overdue' : 'alert',
        textContent: left < 0
          ? `${item.name} — quá hạn ${-left} ngày (${item.expires_at})`
          : `${item.name} — còn ${left} ngày (${item.expires_at})`,
      });
    })
  );
}

function render() {
  const query = searchEl.value.trim().toLowerCase();
  const visible = query ? filterTree(tree, query) : tree;

  treeEl.replaceChildren(...visible.map((node) => renderNode(node, query)));
  emptyEl.hidden = visible.length > 0;
  if (query && visible.length === 0) emptyEl.textContent = 'Không tìm thấy mục nào.';
  renderAlerts();
}

async function load() {
  const query = activeLocale === DEFAULT_LOCALE ? '' : `?locale=${encodeURIComponent(activeLocale)}`;
  tree = await api(query);
  markContainers(tree);
  syncLocaleOptions();
  render();
}

async function run(action) {
  try {
    await action();
    await load();
  } catch (err) {
    alert(err.message);
  }
}

let editing = null;

function openEditor({ item = null, parentId = null } = {}) {
  const isContainer = item ? item.is_container : parentId === null;
  editing = { item, parentId, isContainer };
  document.getElementById('editor-title').textContent = item
    ? `Sửa ${isContainer ? 'thư mục' : 'mục'}`
    : `Thêm ${isContainer ? 'thư mục' : 'mục'}`;
  form.reset();
  translationsEl.replaceChildren();
  document.getElementById('stock-fields').hidden = isContainer;
  document.getElementById('value-fields').hidden = isContainer;
  document.getElementById('expiry-field').hidden = isContainer;
  if (item) {
    formField('name').value = item.default_name ?? item.name;
    if (!isContainer) {
      formField('quantity').value = item.quantity;
      formField('unit').value = item.unit;
      formField('unit_price').value = item.unit_price;
      formField('min_quantity').value = item.min_quantity;
      formField('expires_at').value = item.expires_at || '';
    }
    formField('note').value = item.default_note ?? item.note;
    for (const [locale, translation] of Object.entries(item.translations ?? {})) {
      addTranslationRow(locale, translation);
    }
  }
  dialog.showModal();
  formField('name').focus();
}

form.addEventListener('submit', (event) => {
  if (event.submitter?.value !== 'save') return;
  event.preventDefault();
  const { item, parentId, isContainer } = editing;
  let translations;
  try {
    translations = collectTranslations(item);
  } catch (err) {
    alert(err.message);
    return;
  }
  const body = {
    name: formField('name').value,
    note: formField('note').value,
    translations,
  };
  if (!isContainer) {
    body.quantity = Number(formField('quantity').value || 0);
    body.unit = formField('unit').value;
    body.unit_price = Number(formField('unit_price').value || 0);
    body.min_quantity = Number(formField('min_quantity').value || 0);
    body.expires_at = formField('expires_at').value || null;
  }
  dialog.close();
  run(() =>
    item
      ? api(`/${item.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      : api('', { method: 'POST', body: JSON.stringify({ ...body, parent_id: parentId }) })
  );
});

document.getElementById('add-translation').addEventListener('click', () => {
  addTranslationRow();
  translationsEl.lastElementChild.querySelector('.translation-locale').focus();
});

document.getElementById('add-root').addEventListener('click', () => openEditor());

document.getElementById('expand-all').addEventListener('click', () => {
  collapsed.clear();
  saveCollapsed();
  render();
});

document.getElementById('collapse-all').addEventListener('click', () => {
  (function walk(nodes) {
    for (const node of nodes) {
      if (node.children.length) collapsed.add(node.id);
      walk(node.children);
    }
  })(tree);
  saveCollapsed();
  render();
});

searchEl.addEventListener('input', render);

localeEl.addEventListener('change', () => {
  activeLocale = localeEl.value;
  localStorage.setItem('item-locale', activeLocale);
  load().catch((err) => alert(err.message));
});

document.getElementById('logout').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    location.replace('/login.html');
  }
});

async function start() {
  if (await loadCurrentUser()) await load();
}

start().catch((err) => alert(err.message));
