// Halaman masuk: kirim kredensial ke API; peran dan wilayah ditentukan server dari akun.
const form = document.getElementById('loginForm');
const errorBox = document.getElementById('loginError');
const ROLE_LABEL = { pusat: 'JAGA Pusat', desa: 'JAGA Desa', rescue: 'JAGA Rescue' };
const wantedRole = new URLSearchParams(location.search).get('role');
let demoAvailable = false;

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
      const hint = response.status === 401 && demoAvailable ? ' Di mode demo, pilih salah satu akun contoh di bawah.' : '';
      throw new Error((payload.error || 'Email atau kata sandi salah') + hint);
    }
    location.href = '/app';
  } catch (failure) {
    errorBox.textContent = failure.message;
    button.disabled = false;
    button.textContent = 'Masuk';
  }
});

// Mode demo: server hanya mengirim akun contoh bila memakai data dummy di memori (tidak pernah di produksi).
fetch('/api/config').then(r => r.json()).then(({ data }) => {
  const accounts = data?.demoAccounts || [];
  if (!accounts.length) return;
  demoAvailable = true;
  const role = account => ({ 'JAGA Pusat': 'pusat', 'JAGA Desa': 'desa' }[account.label] || 'rescue');
  const fill = (account, focus) => { form.email.value = account.email; form.password.value = account.password; if (focus) form.password.focus(); };
  const list = document.getElementById('demoList');
  const sorted = [...accounts].sort((a, b) => (role(b) === wantedRole) - (role(a) === wantedRole));
  for (const account of sorted) {
    const button = document.createElement('button');
    button.type = 'button';
    button.innerHTML = `<span></span><small></small>`;
    button.firstChild.textContent = account.label;
    button.lastChild.textContent = account.email;
    if (role(account) === wantedRole) button.classList.add('match');
    button.addEventListener('click', () => fill(account, true));
    list.appendChild(button);
  }
  document.getElementById('demoBox').hidden = false;
  // Datang dari kartu peran di halaman depan: akun contoh untuk peran itu langsung terisi.
  const preset = sorted.find(account => role(account) === wantedRole);
  if (preset) fill(preset, false);
}).catch(() => {});
