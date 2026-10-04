// Halaman depan: bila pengguna sudah punya sesi, tombol masuk berubah menjadi "Buka dashboard".
fetch('/api/auth/status', { credentials: 'same-origin' })
  .then(response => (response.ok ? response.json() : null))
  .then(payload => {
    const session = payload?.data?.authenticated ? payload.data : null;
    if (!session) return;
    const label = { PUSAT: 'JAGA Pusat', DESA: 'JAGA Desa', RESCUE: 'JAGA Rescue' }[session.role] || 'dashboard';
    for (const id of ['ctaTop', 'ctaHero', 'ctaFinal']) {
      const link = document.getElementById(id);
      if (!link) continue;
      link.href = '/app';
      link.textContent = id === 'ctaTop' ? 'Buka dashboard' : `Buka dashboard ${label}`;
    }
  })
  .catch(() => { /* tanpa sesi: tombol tetap mengarah ke halaman masuk */ });
