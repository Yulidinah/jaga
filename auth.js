document.querySelectorAll('.show-pass').forEach(button => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.target);
  input.type = input.type === 'password' ? 'text' : 'password';
  button.textContent = input.type === 'password' ? 'Lihat' : 'Sembunyikan';
}));

const ROLE_PAGE = { PUSAT: 'pusat', DESA: 'desa', RESCUE: 'rescue' };

document.getElementById('loginForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('.submit');
  const error = document.getElementById('loginError');
  const original = button.innerHTML;
  button.innerHTML = 'Memverifikasi akses…';
  button.disabled = true;
  if (error) error.textContent = '';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value, password: form.password.value })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Email atau kata sandi salah');
    // Peran ditentukan server dari akun, bukan dari pilihan di halaman.
    location.href = `/?role=${ROLE_PAGE[payload.data.session.role] || 'desa'}`;
  } catch (failure) {
    if (error) error.textContent = failure.message;
    button.innerHTML = original;
    button.disabled = false;
  }
});

// Halaman pembuatan akun: dikirim ke API (khusus akun JAGA Pusat yang sedang masuk).
document.getElementById('accountForm')?.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.getElementById('accountError');
  const button = form.querySelector('.submit');
  if (error) error.textContent = '';
  button.disabled = true;
  try {
    const villageIds = form.villageIds.value.split(',').map(value => value.trim()).filter(Boolean);
    const response = await fetch('/api/accounts', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        displayName: form.displayName.value,
        email: form.email.value,
        phone: form.phone.value,
        role: form.role.value.toUpperCase(),
        password: form.password.value,
        organizationName: form.organizationName.value || undefined,
        villageIds
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401) { location.href = '/login'; return; }
    if (!response.ok) throw new Error(payload.error || 'Gagal membuat akun');
    document.getElementById('success').classList.add('show');
  } catch (failure) {
    if (error) error.textContent = failure.message;
  } finally {
    button.disabled = false;
  }
});
