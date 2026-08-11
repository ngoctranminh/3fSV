const form = document.getElementById('create-user-form');
const messageEl = document.getElementById('form-message');
const listEl = document.getElementById('user-list');
let currentUser = null;

function formField(name) {
  return form.elements.namedItem(name);
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) if (child) node.append(child);
  return node;
}

async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = res.status === 204 ? null : await res.json();
  if (res.status === 401) {
    location.replace('/login.html');
    throw new Error('Bạn cần đăng nhập');
  }
  if (!res.ok) throw new Error(data?.error || 'Không thực hiện được');
  return data;
}

function showMessage(message, type) {
  messageEl.textContent = message;
  messageEl.className = `form-message ${type}`;
  messageEl.hidden = false;
}

function renderUsers(users) {
  document.getElementById('user-count').textContent = `${users.length} tài khoản`;
  listEl.replaceChildren(
    ...users.map((user) => {
      const isCurrent = user.id === currentUser.id;
      const details = el('div', { className: 'user-details' }, [
        el('strong', { textContent: user.username }),
        el('span', {
          className: `role-badge ${user.role}`,
          textContent: user.role === 'admin' ? 'Quản trị viên' : 'Người dùng',
        }),
        isCurrent ? el('span', { className: 'current-badge', textContent: 'Đang đăng nhập' }) : null,
        el('small', {
          textContent: `${user.session_count} phiên · Tạo ${user.created_at}`,
        }),
      ]);

      const remove = el('button', {
        className: 'del',
        type: 'button',
        textContent: 'Xóa',
        disabled: isCurrent,
        title: isCurrent ? 'Không thể tự xóa tài khoản đang đăng nhập' : `Xóa ${user.username}`,
      });
      remove.addEventListener('click', async () => {
        if (!confirm(`Xóa tài khoản "${user.username}"? Tất cả phiên đăng nhập của tài khoản này cũng sẽ bị thoát.`)) return;
        try {
          await request(`/api/users/${user.id}`, { method: 'DELETE' });
          await loadUsers();
        } catch (err) {
          showMessage(err.message, 'error');
        }
      });

      return el('div', { className: 'user-row' }, [details, remove]);
    })
  );
}

async function loadUsers() {
  const data = await request('/api/users');
  renderUsers(data.users);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  messageEl.hidden = true;

  const password = formField('password').value;
  if (password !== formField('confirm_password').value) {
    showMessage('Hai mật khẩu không khớp', 'error');
    formField('confirm_password').focus();
    return;
  }

  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const data = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: formField('username').value.trim(),
        password,
      }),
    });
    form.reset();
    showMessage(`Đã tạo tài khoản ${data.user.username}`, 'success');
    await loadUsers();
  } catch (err) {
    showMessage(err.message, 'error');
  } finally {
    submit.disabled = false;
  }
});

document.getElementById('logout').addEventListener('click', async () => {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    location.replace('/login.html');
  }
});

async function start() {
  const data = await request('/api/auth/me');
  currentUser = data.user;
  if (currentUser.role !== 'admin') {
    document.querySelector('main').replaceChildren(
      el('p', { className: 'form-message error', textContent: 'Chỉ quản trị viên được quản lý tài khoản.' })
    );
    return;
  }
  document.getElementById('current-user').textContent = currentUser.username;
  await loadUsers();
}

start().catch((err) => showMessage(err.message, 'error'));
