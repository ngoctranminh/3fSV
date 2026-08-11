const form = document.getElementById('login-form');
const errorEl = document.getElementById('login-error');
const submitButton = form.querySelector('button[type="submit"]');

function field(name) {
  return form.elements.namedItem(name);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  submitButton.disabled = true;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: field('username').value.trim(),
        password: field('password').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Không đăng nhập được');
    location.replace('/');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    field('password').select();
  } finally {
    submitButton.disabled = false;
  }
});

fetch('/api/auth/me').then((res) => {
  if (res.ok) location.replace('/');
}).catch(() => {});
