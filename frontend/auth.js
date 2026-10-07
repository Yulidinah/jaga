// Halaman masuk: kirim kredensial ke API; peran dan wilayah ditentukan server dari akun.
const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const ROLE_LABEL = { pusat: 'JAGA Pusat', desa: 'JAGA Desa', rescue: 'JAGA Rescue' };
const wantedRole = new URLSearchParams(location.search).get('role');

if (ROLE_LABEL[wantedRole]) {
  document.getElementById('loginTitle').textContent = `Masuk sebagai ${ROLE_LABEL[wantedRole]}`;
  document.getElementById('loginIntro').textContent = 'Gunakan akun yang diberikan JAGA Pusat untuk peran ini.';
}

document.querySelectorAll('.show-pass').forEach(button => button.addEventListener('click', () => {
  const input = document.getElementById(button.dataset.target);
  input.type = input.type === 'password' ? 'text' : 'password';
  button.textContent = input.type === 'password' ? 'Lihat' : 'Sembunyikan';
}));

form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('.submit');
  errorBox.textContent = '';
  if (!form.email.value || !form.password.value) { errorBox.textContent = 'Email dan kata sandi wajib diisi.'; return; }
  button.disabled = true;
  button.textContent = 'Memverifikasi…';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email.value.trim(), password: form.password.value })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || 'Email atau kata sandi salah');
    }
    location.href = '/app';
  } catch (failure) {
    errorBox.textContent = failure.message;
    button.disabled = false;
    button.textContent = 'Masuk';
  }
});
