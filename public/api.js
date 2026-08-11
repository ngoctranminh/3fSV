const methodEl = document.getElementById('method');
const pathEl = document.getElementById('path');
const bodyEl = document.getElementById('body');
const statusEl = document.getElementById('status');
const codeEl = document.getElementById('code');
const metaEl = document.getElementById('meta');
const responseEl = document.getElementById('response');

const PRESETS = [
  {
    method: 'GET',
    path: '/api/items',
    label: 'Lấy cây mục',
    desc: 'Toàn bộ kho dạng cây. Thêm ?flat=1 để lấy danh sách phẳng.',
  },
  {
    method: 'GET',
    path: '/api/items/expiring?days=7',
    label: 'Sắp hết hạn',
    desc: 'Các mục hết hạn trong N ngày tới.',
  },
  {
    method: 'GET',
    path: '/api/items/1',
    label: 'Lấy một mục',
    desc: 'Một mục kèm các mục con của nó.',
  },
  {
    method: 'POST',
    path: '/api/items',
    label: 'Tạo mục',
    desc: 'Bỏ trống parent_id để tạo nhóm gốc. min_quantity là ngưỡng báo sắp hết.',
    body: {
      parent_id: null,
      name: 'Gạo thơm',
      quantity: 2,
      unit: 'kg',
      unit_price: 32000,
      min_quantity: 1,
      expires_at: null,
      note: '',
    },
  },
  {
    method: 'PATCH',
    path: '/api/items/1',
    label: 'Sửa mục',
    desc: 'Chỉ gửi những trường muốn đổi. Sửa quantity sẽ tự ghi một giao dịch vào sổ.',
    body: { name: 'Tên mới', quantity: 5, unit_price: 35000 },
  },
  {
    method: 'POST',
    path: '/api/items/1/adjust',
    label: 'Cộng trừ số lượng',
    desc: 'delta âm để bớt. Số lượng không xuống dưới 0.',
    body: { delta: -1 },
  },
  {
    method: 'DELETE',
    path: '/api/items/1',
    label: 'Xoá mục',
    desc: 'Xoá luôn toàn bộ mục con bên trong.',
    danger: true,
  },
  {
    method: 'GET',
    path: '/api/summary',
    label: 'Số liệu tổng quan',
    desc: 'Bốn thẻ ở đầu màn Tổng quan và số badge cảnh báo.',
  },
  {
    method: 'GET',
    path: '/api/stats/value-history?days=7',
    label: 'Biểu đồ giá trị tồn',
    desc: 'Giá trị tồn kho từng ngày. Quy theo đơn giá hiện tại, không theo giá lúc phát sinh.',
  },
  {
    method: 'GET',
    path: '/api/alerts',
    label: 'Danh sách cảnh báo',
    desc: 'Gộp sắp hết, sắp hết hạn và quá hạn. Sắp theo mức nghiêm trọng.',
  },
  {
    method: 'GET',
    path: '/api/transactions?limit=10',
    label: 'Lịch sử nhập/xuất',
    desc: 'Lọc thêm bằng item_id, kind, source, from, to.',
  },
  {
    method: 'POST',
    path: '/api/transactions',
    label: 'Ghi nhập/xuất',
    desc: 'kind "in" là nhập, "out" là xuất. Nhập kèm unit_price sẽ cập nhật giá vốn của mục.',
    body: {
      item_id: 3,
      kind: 'in',
      quantity: 5,
      unit_price: 180000,
      note: 'Nhập hàng chợ đầu mối',
    },
  },
  {
    method: 'POST',
    path: '/api/transactions/1/undo',
    label: 'Hoàn tác giao dịch',
    desc: 'Ghi một giao dịch bù chiều ngược lại, giữ nguyên vết lịch sử.',
  },
  {
    method: 'DELETE',
    path: '/api/transactions/1',
    label: 'Xoá giao dịch',
    desc: 'Đảo ngược tác động lên tồn kho. Báo lỗi nếu làm tồn kho xuống âm.',
    danger: true,
  },
  {
    method: 'GET',
    path: '/api/documents/types',
    label: 'Loại phiếu nhập/xuất',
    desc: 'Bốn nút hành động. Lưu ý "Trả hàng" nằm tab Nhập nhưng type là "out" vì trừ kho.',
  },
  {
    method: 'GET',
    path: '/api/documents/summary',
    label: 'Thông tin hôm nay',
    desc: 'Tổng nhập / tổng xuất kèm số phiếu. Đổi ?period=week|month|all.',
  },
  {
    method: 'GET',
    path: '/api/documents?limit=10',
    label: 'Danh sách phiếu',
    desc: 'Lọc bằng q, type, subtype, period, from, to, status.',
  },
  {
    method: 'GET',
    path: '/api/documents/1',
    label: 'Chi tiết phiếu',
    desc: 'Phiếu kèm toàn bộ dòng hàng bên trong.',
  },
  {
    method: 'POST',
    path: '/api/documents',
    label: 'Tạo phiếu',
    desc: 'Chỉ gửi subtype, server tự suy ra chiều nhập/xuất và sinh mã phiếu.',
    body: {
      subtype: 'purchase',
      party: 'Nhà cung cấp A',
      note: '',
      lines: [
        { item_id: 3, quantity: 5, unit_price: 180000 },
        { item_id: 5, quantity: 10, unit_price: 25000 },
      ],
    },
  },
  {
    method: 'POST',
    path: '/api/documents/1/cancel',
    label: 'Huỷ phiếu',
    desc: 'Đảo ngược tồn kho, giữ lại phiếu để kiểm toán. Báo lỗi nếu làm tồn kho âm.',
    danger: true,
  },
  {
    method: 'GET',
    path: '/api/documents/parties',
    label: 'Danh sách NCC',
    desc: 'Gợi ý nhà cung cấp và nơi nhận đã dùng, sắp theo lần dùng gần nhất.',
  },
  {
    method: 'GET',
    path: '/health',
    label: 'Kiểm tra server',
    desc: 'Trạng thái và thời gian server đã chạy.',
  },
];

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child) node.append(child);
  return node;
}

function applyPreset(preset) {
  methodEl.value = preset.method;
  pathEl.value = preset.path;
  bodyEl.value = preset.body ? JSON.stringify(preset.body, null, 2) : '';
  syncBodyState();
  for (const button of document.querySelectorAll('.endpoint')) {
    button.classList.toggle('active', button.dataset.path === preset.path && button.dataset.method === preset.method);
  }
}

// GET và DELETE không gửi kèm body nên vô hiệu hoá ô nhập cho khỏi hiểu nhầm
function syncBodyState() {
  const disabled = methodEl.value === 'GET' || methodEl.value === 'DELETE';
  bodyEl.disabled = disabled;
  bodyEl.parentElement.classList.toggle('disabled', disabled);
}

function renderEndpoints() {
  document.getElementById('endpoints').replaceChildren(
    ...PRESETS.map((preset) => {
      const button = el('button', {
        className: `endpoint${preset.danger ? ' danger' : ''}`,
        type: 'button',
      }, [
        el('span', { className: `verb v-${preset.method.toLowerCase()}`, textContent: preset.method }),
        el('span', { className: 'ep-label', textContent: preset.label }),
        el('code', { className: 'ep-path', textContent: preset.path }),
        el('span', { className: 'ep-desc', textContent: preset.desc }),
      ]);
      button.dataset.path = preset.path;
      button.dataset.method = preset.method;
      button.addEventListener('click', () => applyPreset(preset));
      return button;
    })
  );
}

function showResult({ ok, status, statusText, elapsed, text }) {
  statusEl.hidden = false;
  responseEl.hidden = false;
  codeEl.textContent = status ? `${status} ${statusText}` : 'Không gửi được';
  codeEl.className = `code ${ok ? 'ok' : 'bad'}`;
  metaEl.textContent = elapsed === null ? '' : `${elapsed}ms · ${new Blob([text]).size} byte`;

  try {
    responseEl.textContent = JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    responseEl.textContent = text || '(rỗng)';
  }
}

async function send() {
  const method = methodEl.value;
  const path = pathEl.value.trim();
  if (!path) return;

  const options = { method, headers: {} };

  if (method !== 'GET' && method !== 'DELETE') {
    const raw = bodyEl.value.trim();
    if (raw) {
      try {
        JSON.parse(raw);
      } catch (err) {
        showResult({
          ok: false,
          status: 0,
          statusText: '',
          elapsed: null,
          text: `JSON không hợp lệ: ${err.message}`,
        });
        return;
      }
      options.headers['Content-Type'] = 'application/json';
      options.body = raw;
    }
  }

  document.getElementById('send').disabled = true;
  const startedAt = performance.now();
  try {
    const res = await fetch(path, options);
    const text = await res.text();
    showResult({
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      elapsed: Math.round(performance.now() - startedAt),
      text,
    });
  } catch (err) {
    showResult({ ok: false, status: 0, statusText: '', elapsed: null, text: err.message });
  } finally {
    document.getElementById('send').disabled = false;
  }
}

document.getElementById('send').addEventListener('click', send);
methodEl.addEventListener('change', syncBodyState);
pathEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') send();
});

renderEndpoints();
applyPreset(PRESETS[0]);
