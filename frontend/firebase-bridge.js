/**
 * JAGA — Firebase Realtime Database Bridge & IoT Control Panel
 * Menghubungkan kalung ESP32 (JAGA-052) via Firebase RTDB ke Dashboard JAGA.
 */
(function () {
  'use strict';

  const FIREBASE_CONFIG = {
    databaseURL: 'https://jaga-51a35-default-rtdb.asia-southeast1.firebasedatabase.app'
  };
  const DEVICE_ID = 'JAGA-052';
  const OWNER_NAME = 'Hj. Siti Aminah (Prototipe ESP32)';
  const FIREBASE_REST_URL = `${FIREBASE_CONFIG.databaseURL}/kalung/${DEVICE_ID}.json`;

  let db = null;
  let kalungRef = null;
  let audioCtx = null;
  let oscillator = null;
  let gainNode = null;
  let isSirenPlaying = false;
  let sirenInterval = null;

  const currentData = {
    lat: 5.54829,
    lng: 95.323753,
    status_alarm: 'AMAN',
    sos: false,
    siaga: false,
    aman: true,
    online: false,
    lastUpdated: null,
    latencyMs: null
  };

  // 1. Audio Sirine Web Audio API
  function initAudio() {
    try {
      if (!audioCtx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (AudioCtor) audioCtx = new AudioCtor();
      }
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch (e) {
      console.warn('[Audio Init Warning]', e);
    }
  }

  function playSiren() {
    if (isSirenPlaying) return;
    initAudio();
    if (!audioCtx) return;
    try {
      isSirenPlaying = true;
      oscillator = audioCtx.createOscillator();
      gainNode = audioCtx.createGain();
      oscillator.type = 'square';
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      gainNode.gain.value = 0.08;
      oscillator.start();

      let isHigh = true;
      sirenInterval = setInterval(() => {
        if (oscillator) {
          oscillator.frequency.value = isHigh ? 800 : 600;
        }
        isHigh = !isHigh;
      }, 400);
    } catch (e) {
      console.warn('[Play Siren Warning]', e);
    }
  }

  function stopSiren() {
    isSirenPlaying = false;
    if (sirenInterval) {
      clearInterval(sirenInterval);
      sirenInterval = null;
    }
    if (oscillator) {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch (e) {}
      oscillator = null;
    }
  }

  // 2. Notifikasi Toast
  function showToast(msg, isError = false) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = `toast show${isError ? ' error' : ''}`;
    toast.style.zIndex = '99999';
    clearTimeout(window._jagaToastTimer);
    window._jagaToastTimer = setTimeout(() => {
      toast.className = 'toast';
    }, 4000);
  }

  // 3. Uji Koneksi IoT
  window.testIotConnection = async function () {
    const testBtn = document.getElementById('jaga-btn-test-conn');
    const connStatus = document.getElementById('jaga-conn-status');
    if (testBtn) {
      testBtn.disabled = true;
      testBtn.innerText = 'Menguji koneksi…';
    }

    const start = Date.now();
    let success = false;
    let latency = 0;
    let resData = null;

    // Coba via Backend Server proxy terlebih dahulu (bebas blokir CSP)
    try {
      const res = await fetch('/api/iot/test', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          success = true;
          latency = json.latencyMs || (Date.now() - start);
          resData = json.data;
        }
      }
    } catch (e) {
      console.warn('[Test Backend Proxy Fallback]', e);
    }

    // Jika proxy backend belum terjangkau, coba direct Firebase REST
    if (!success) {
      try {
        const res = await fetch(FIREBASE_REST_URL, { cache: 'no-store' });
        if (res.ok) {
          resData = await res.json();
          latency = Date.now() - start;
          success = true;
        }
      } catch (e) {
        console.warn('[Test Direct REST Fallback]', e);
      }
    }

    if (testBtn) {
      testBtn.disabled = false;
      testBtn.innerText = '⚡ Uji Koneksi IoT';
    }

    if (success && resData) {
      currentData.online = true;
      currentData.latencyMs = latency;
      if (resData.lat !== undefined && resData.lat !== null) currentData.lat = Math.abs(Number(resData.lat));
      if (resData.lng !== undefined && resData.lng !== null) currentData.lng = Number(resData.lng);
      if (resData.status_alarm) currentData.status_alarm = resData.status_alarm;
      currentData.sos = resData.sos === true;
      currentData.siaga = resData.siaga === true;
      currentData.aman = resData.aman === true;
      currentData.lastUpdated = new Date();

      updateWidgetUI();
      updateMapMarker();

      if (connStatus) {
        connStatus.innerHTML = `<span style="color:#2f7d4e;">● Terhubung</span> (${latency}ms)`;
      }
      showToast(`Koneksi IoT JAGA-052 aman (${latency}ms)! Status: ${currentData.status_alarm}`);
    } else {
      if (connStatus) {
        connStatus.innerHTML = `<span style="color:#c8372d;">● Terputus</span>`;
      }
      showToast('Gagal menghubungi Firebase RTDB IoT. Periksa jaringan!', true);
    }
  };

  // 4. Kontrol Alarm (Dual-Channel: Backend Server + Firebase REST + SDK)
  window.setKalungAlarm = async function (status, isDesaBroadcast = false) {
    initAudio();

    const btnDarurat = document.getElementById('jaga-btn-alarm-darurat');
    const btnSiaga = document.getElementById('jaga-btn-alarm-siaga');
    const btnAman = document.getElementById('jaga-btn-alarm-aman');

    const targetBtn = status === 'DARURAT' ? btnDarurat : (status === 'SIAGA' ? btnSiaga : btnAman);
    const originalText = targetBtn ? targetBtn.innerText : '';
    if (targetBtn) {
      targetBtn.disabled = true;
      targetBtn.innerText = 'Mengirim sinyal…';
    }

    const payload = (status === 'DARURAT') ? {
      status_alarm: 'DARURAT',
      sos: true,
      siaga: false,
      aman: false,
      last_active: Date.now()
    } : (status === 'SIAGA') ? {
      status_alarm: 'SIAGA',
      sos: false,
      siaga: true,
      aman: false,
      last_active: Date.now()
    } : {
      status_alarm: 'AMAN',
      sos: false,
      siaga: false,
      aman: true,
      last_active: Date.now()
    };

    window._jagaDesaBroadcastTrigger = Boolean(isDesaBroadcast && (status === 'DARURAT' || status === 'SIAGA'));

    // Respon UI langsung (responsif & instan)
    currentData.status_alarm = payload.status_alarm;
    currentData.sos = payload.sos;
    currentData.siaga = payload.siaga;
    currentData.aman = payload.aman;
    currentData.lastUpdated = new Date();

    updateWidgetUI();
    updateMapMarker();

    if (status === 'DARURAT') {
      playSiren();
    } else {
      stopSiren();
    }

    let sent = false;

    // Alarm dikirim lewat backend (terautentikasi); browser tidak menulis langsung ke Firebase.
    try {
      const res = await fetch('/api/iot/alarm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (res.ok) {
        sent = true;
      }
    } catch (e) {
      console.warn('[Bridge Backend Alarm]', e);
    }

    if (targetBtn) {
      targetBtn.disabled = false;
      targetBtn.innerText = '✓ Terkirim!';
      setTimeout(() => {
        targetBtn.innerText = originalText;
      }, 2000);
    }

    if (sent) {
      showToast(`Sinyal ${status} berhasil terkirim ke kalung ${DEVICE_ID}!`);
    } else {
      showToast(`Gagal mengirim sinyal ke kalung ${DEVICE_ID}`, true);
    }
  };

  // 5. Render Marker Kalung di Peta Leaflet
  function updateMapMarker() {
    if (typeof L === 'undefined') return;

    const maps = (window.jagaState && window.jagaState.maps) ? window.jagaState.maps : [];
    if (!maps.length) return;

    const rawLat = Number(currentData.lat !== null && currentData.lat !== undefined ? currentData.lat : 5.54829);
    const lat = Math.abs(rawLat);
    const lng = Number(currentData.lng !== null && currentData.lng !== undefined ? currentData.lng : 95.323753);
    const isSos = currentData.sos || currentData.status_alarm === 'DARURAT';
    const isSiaga = currentData.siaga || currentData.status_alarm === 'SIAGA';
    const pinColor = isSos ? 'red' : (isSiaga ? 'orange' : 'green');

    maps.forEach(map => {
      try {
        if (!map._jagaLiveMarker) {
          const iconHtml = `<div class="pin ${pinColor}${isSos ? ' sos' : ''}" style="box-shadow: 0 0 14px ${isSos ? 'rgba(200,55,45,0.9)' : 'rgba(47,125,78,0.7)'}; border: 3px solid #fff;"></div>`;
          const customIcon = L.divIcon({
            className: 'jaga-esp-pin',
            html: iconHtml,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });

          const marker = L.marker([lat, lng], { icon: customIcon, zIndexOffset: 1000 }).addTo(map);
          marker.bindTooltip(`<b>${DEVICE_ID} (ESP32 Live)</b> · ${isSos ? 'SOS' : currentData.status_alarm}`, { permanent: false, direction: 'top' });
          marker.bindPopup(`
            <div style="font-size:13px; line-height:1.5;">
              <b style="color:${isSos ? '#c8372d' : '#17513a'}; font-size:14px;">${DEVICE_ID} · Kalung Fisik Live</b><br>
              <span>Warga: <b>${OWNER_NAME}</b></span><br>
              <span>Status: <b style="color:${isSos ? '#c8372d' : '#17513a'}">${currentData.status_alarm}</b></span><br>
              <small style="color:#5b695f;">Lokasi: Gedung TDMRC USK (${lat.toFixed(5)}, ${lng.toFixed(5)})</small>
            </div>
          `);
          map._jagaLiveMarker = marker;
        } else {
          map._jagaLiveMarker.setLatLng([lat, lng]);
          const iconHtml = `<div class="pin ${pinColor}${isSos ? ' sos' : ''}" style="box-shadow: 0 0 14px ${isSos ? 'rgba(200,55,45,0.9)' : 'rgba(47,125,78,0.7)'}; border: 3px solid #fff;"></div>`;
          map._jagaLiveMarker.setIcon(L.divIcon({
            className: 'jaga-esp-pin',
            html: iconHtml,
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          }));
        }
      } catch (err) {}
    });
  }
  window.updateMapMarker = updateMapMarker;

  // 6. Floating Widget & Banner Darurat
  function ensureWidgets() {
    // Banner Darurat SOS
    // Navigasi ke Peta dan Pusatkan ke Kalung
    const focusKalungOnMap = () => {
      const lat = Number(currentData.lat || 5.54829);
      const lng = Number(currentData.lng || 95.323753);

      if (!location.hash.includes('peta') && !location.hash.includes('operasi')) {
        location.hash = '#/peta';
      }

      setTimeout(() => {
        const maps = (window.jagaState && window.jagaState.maps) ? window.jagaState.maps : [];
        if (maps.length) {
          maps.forEach(m => {
            try {
              m.invalidateSize();
              m.setView([lat, lng], 17);
              if (m._jagaLiveMarker) m._jagaLiveMarker.openPopup();
            } catch (e) {}
          });
        }
      }, 300);
    };

    // Top Emergency Banner
    let sosBanner = document.getElementById('jaga-firebase-sos-banner');
    if (!sosBanner) {
      sosBanner = document.createElement('div');
      sosBanner.id = 'jaga-firebase-sos-banner';
      sosBanner.style.cssText = `
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 9999;
        background: #b3261e;
        color: #fff;
        padding: 12px 24px;
        box-shadow: 0 4px 16px rgba(179,38,30,0.4);
        justify-content: space-between;
        align-items: center;
        animation: pulseBg 1.5s infinite;
        font-family: inherit;
      `;
      sosBanner.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px; min-width:0; flex:1;">
          <span style="display:inline-block; width:10px; height:10px; min-width:10px; border-radius:50%; background:#fff; animation:pulseDot 1s infinite;"></span>
          <b id="jaga-banner-title" style="font-size:14.5px; letter-spacing:0.02em;">PERINGATAN DARURAT (SOS) DARI KALUNG FISIK ${DEVICE_ID}!</b>
          <span id="jaga-banner-sub" style="opacity:0.9; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">— ${OWNER_NAME}</span>
        </div>
        <div style="display:flex; gap:10px; margin-left:14px; flex-shrink:0;">
          <button id="jaga-btn-focus-map" style="padding:6px 14px; border-radius:8px; border:1px solid #fff; background:transparent; color:#fff; font-weight:700; cursor:pointer;">Lihat di Peta</button>
          <button id="jaga-btn-reset-aman" style="padding:6px 14px; border-radius:8px; border:0; background:#fff; color:#b3261e; font-weight:700; cursor:pointer;">Matikan Sirine & Reset Aman</button>
        </div>
      `;
      document.body.appendChild(sosBanner);

      document.getElementById('jaga-btn-reset-aman').onclick = () => window.setKalungAlarm('AMAN');
      document.getElementById('jaga-btn-focus-map').onclick = focusKalungOnMap;
    }

    // Floating Widget (Badge Telemetri ESP32) - Diletakkan di Kiri Bawah agar tidak menutupi popup notifikasi di Kanan Bawah
    let widget = document.getElementById('jaga-firebase-widget');
    if (!widget) {
      widget = document.createElement('div');
      widget.id = 'jaga-firebase-widget';
      widget.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 110;
        font-family: var(--font-body, system-ui, sans-serif);
      `;
      widget.innerHTML = `
        <div id="jaga-widget-btn" style="display:flex; align-items:center; gap:8px; padding:9px 15px; border-radius:99px; background:#123a29; color:#fff; cursor:pointer; box-shadow:0 8px 24px rgba(18,58,41,0.28); border:1px solid rgba(255,255,255,0.18); transition:transform .15s;">
          <span id="jaga-widget-dot" style="width:9px; height:9px; border-radius:50%; background:#3fae61;"></span>
          <b style="font-size:12px; letter-spacing:0.04em;">ESP32: ${DEVICE_ID}</b>
          <span id="jaga-widget-status" style="font-size:11px; padding:2px 8px; border-radius:99px; background:rgba(255,255,255,0.15); font-weight:700;">AMAN</span>
        </div>
        <div id="jaga-widget-panel" style="display:none; position:absolute; bottom:48px; left:0; width:310px; max-width:calc(100vw - 32px); box-sizing:border-box; background:#fff; border-radius:18px; box-shadow:0 12px 36px rgba(0,0,0,0.18); border:1px solid #e4e9e4; padding:18px; color:#14231b;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #edf1ed; padding-bottom:10px; margin-bottom:12px;">
            <b style="font-size:14px; color:#17513a;">Telemetri Kalung Fisik</b>
            <span id="jaga-conn-status" style="font-size:11px; background:#e4efe7; color:#17513a; padding:2px 8px; border-radius:99px; font-weight:700;">Online</span>
          </div>
          <div style="font-size:12px; display:grid; gap:6px; color:#5b695f; margin-bottom:14px;">
            <div>ID Perangkat: <b style="color:#14231b;">${DEVICE_ID}</b></div>
            <div>Status: <b id="jaga-panel-status" style="color:#2f7d4e;">AMAN</b></div>
            <div>GPS: <b id="jaga-panel-gps" style="color:#14231b;">5.54829, 95.32375</b></div>
            <div>Sinkronisasi: <span id="jaga-panel-lastsync" style="color:#5b695f;">Memeriksa…</span></div>
          </div>
          <div style="display:grid; gap:8px;">
            <button id="jaga-btn-test-conn" onclick="window.testIotConnection()" style="padding:8px; border-radius:10px; border:1px solid #cfdcd2; background:#f1f6f2; color:#17513a; font-weight:700; font-size:12px; cursor:pointer;">⚡ Uji Koneksi IoT</button>
            <button id="jaga-btn-alarm-siaga" onclick="window.setKalungAlarm('SIAGA')" style="padding:8px; border-radius:10px; border:0; background:#e2700d; color:#fff; font-weight:700; font-size:12px; cursor:pointer;">Kirim Sinyal SIAGA</button>
            <button id="jaga-btn-alarm-darurat" onclick="window.setKalungAlarm('DARURAT')" style="padding:8px; border-radius:10px; border:0; background:#c8372d; color:#fff; font-weight:700; font-size:12px; cursor:pointer;">Kirim Sinyal DARURAT</button>
            <button id="jaga-btn-alarm-aman" onclick="window.setKalungAlarm('AMAN')" style="padding:8px; border-radius:10px; border:1px solid #e4e9e4; background:#f9faf9; color:#17513a; font-weight:700; font-size:12px; cursor:pointer;">Reset Status AMAN</button>
          </div>
        </div>
      `;
      document.body.appendChild(widget);

      const btn = document.getElementById('jaga-widget-btn');
      const panel = document.getElementById('jaga-widget-panel');
      btn.onclick = () => {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
      };
    }
  }

  function updateWidgetUI() {
    const isSos = currentData.sos || currentData.status_alarm === 'DARURAT';
    const isSiaga = currentData.siaga || currentData.status_alarm === 'SIAGA';
    const statusText = currentData.status_alarm || (isSos ? 'DARURAT' : (isSiaga ? 'SIAGA' : 'AMAN'));

    const sosBanner = document.getElementById('jaga-firebase-sos-banner');
    if (sosBanner) {
      sosBanner.style.display = isSos ? 'flex' : 'none';
      const titleEl = document.getElementById('jaga-banner-title');
      const subEl = document.getElementById('jaga-banner-sub');
      if (titleEl) {
        if (window._jagaDesaBroadcastTrigger) {
          titleEl.innerText = `STATUS DARURAT SEDANG DIKIRIM KE SELURUH KALUNG (TERMASUK ${DEVICE_ID})!`;
          if (subEl) subEl.innerText = '— Siaga / Evakuasi Aktif';
        } else {
          titleEl.innerText = `PERINGATAN DARURAT (SOS) DARI KALUNG FISIK ${DEVICE_ID}!`;
          if (subEl) subEl.innerText = `— ${OWNER_NAME}`;
        }
      }
    }

    const dot = document.getElementById('jaga-widget-dot');
    const badge = document.getElementById('jaga-widget-status');
    const panelStatus = document.getElementById('jaga-panel-status');
    const panelGps = document.getElementById('jaga-panel-gps');
    const panelSync = document.getElementById('jaga-panel-lastsync');

    if (dot) dot.style.background = isSos ? '#c8372d' : (isSiaga ? '#e2700d' : '#3fae61');
    if (badge) {
      badge.innerText = statusText;
      badge.style.background = isSos ? '#c8372d' : (isSiaga ? '#e2700d' : 'rgba(255,255,255,0.15)');
    }
    if (panelStatus) {
      panelStatus.innerText = statusText;
      panelStatus.style.color = isSos ? '#c8372d' : (isSiaga ? '#e2700d' : '#2f7d4e');
    }
    if (panelGps && currentData.lat && currentData.lng) {
      panelGps.innerText = `${Number(currentData.lat).toFixed(5)}, ${Number(currentData.lng).toFixed(5)}`;
    }
    if (panelSync && currentData.lastUpdated) {
      panelSync.innerText = currentData.lastUpdated.toLocaleTimeString('id-ID');
    }
  }

  // 7. Poller Mandiri (Menjamin sync walau WebSocket SDK ditolak/offline)
  async function pollIotStatus() {
    try {
      let data = null;
      // Coba lewat backend proxy
      const res = await fetch('/api/iot/status', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.data) data = json.data;
      }
      // Fallback direct REST
      if (!data) {
        const res2 = await fetch(FIREBASE_REST_URL, { cache: 'no-store' });
        if (res2.ok) data = await res2.json();
      }

      if (data) {
        currentData.online = true;
        if (data.lat !== undefined && data.lat !== null) currentData.lat = Math.abs(Number(data.lat));
        if (data.lng !== undefined && data.lng !== null) currentData.lng = Number(data.lng);
        currentData.status_alarm = data.status_alarm || 'AMAN';
        currentData.sos = data.sos === true;
        currentData.siaga = data.siaga === true;
        currentData.aman = data.aman === true;
        currentData.lastUpdated = new Date();

        if (currentData.sos || currentData.status_alarm === 'DARURAT') {
          playSiren();
            } else {
          stopSiren();
        }

        updateWidgetUI();
        updateMapMarker();
      }
    } catch (err) {
      // Polling network warning diabaikan
    }
  }

  // 8. Sambungkan ke Firebase SDK jika tersedia
  function initFirebase() {
    if (typeof firebase === 'undefined') {
      console.info('[JAGA Bridge] Firebase SDK belum termuat, beralih ke Mode REST & Proxy polling.');
      pollIotStatus();
      return;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(FIREBASE_CONFIG);
      }
      db = firebase.database();
      kalungRef = db.ref('kalung/' + DEVICE_ID);

      kalungRef.on('value', snapshot => {
        const data = snapshot.val();
        if (!data) return;

        currentData.online = true;
        if (data.lat !== undefined && data.lat !== null) currentData.lat = Math.abs(Number(data.lat));
        if (data.lng !== undefined && data.lng !== null) currentData.lng = Number(data.lng);
        currentData.status_alarm = data.status_alarm || 'AMAN';
        currentData.sos = data.sos === true;
        currentData.siaga = data.siaga === true;
        currentData.aman = data.aman === true;
        currentData.lastUpdated = new Date();

        if (currentData.sos || currentData.status_alarm === 'DARURAT') {
          playSiren();
            } else {
          stopSiren();
        }

        updateWidgetUI();
        updateMapMarker();
      });

      console.log('[JAGA Bridge] Terhubung ke Firebase RTDB kalung/' + DEVICE_ID);
    } catch (err) {
      console.warn('[JAGA Bridge SDK Fallback]', err);
    }
  }


  // 10. Interceptor form alarm dari Desa/Rescue
  window.addEventListener('submit', (e) => {
    const form = e.target.closest('form');
    if (!form) return;
    const sev = form.querySelector('[name="severity"]')?.value;
    if (sev === 'AWAS') window.setKalungAlarm('DARURAT');
    else if (sev === 'SIAGA') window.setKalungAlarm('SIAGA');
    else if (sev === 'NORMAL') window.setKalungAlarm('AMAN');
  }, true);

  // 11. Inisialisasi
  function startup() {
    ensureWidgets();
    initFirebase();
    pollIotStatus();
    setInterval(pollIotStatus, 3500);
    setInterval(updateMapMarker, 2500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startup);
  } else {
    startup();
  }

})();
