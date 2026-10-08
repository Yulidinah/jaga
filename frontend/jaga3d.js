import * as THREE from '/vendor/three/three.module.js';
import { OrbitControls } from '/vendor/three/controls/OrbitControls.js';

const wrapper = document.getElementById('luneraNecklace');
if (!wrapper) return;
wrapper.innerHTML = '';
wrapper.style.position = 'relative';

// ── Canvas ────────────────────────────────────────────────────────────────────
const canvas = document.createElement('canvas');
canvas.style.cssText = 'width:100%;height:100%;display:block;border-radius:20px;cursor:grab;touch-action:none;';
wrapper.appendChild(canvas);

// ── UI Overlay ────────────────────────────────────────────────────────────────
const info = document.createElement('div');
info.style.cssText = `position:absolute;bottom:16px;left:50%;transform:translateX(-50%);
  background:rgba(255,255,255,0.95);backdrop-filter:blur(12px);
  padding:10px 18px;border-radius:12px;font-size:13px;line-height:1.55;
  color:#123a29;font-family:inherit;min-width:200px;max-width:260px;text-align:center;
  box-shadow:0 6px 24px rgba(0,0,0,0.12);border:1px solid rgba(255,255,255,0.7);
  pointer-events:none;transition:opacity 0.3s;opacity:0;z-index:10;`;
wrapper.appendChild(info);

const hint = document.createElement('div');
hint.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);font-size:11px;color:#aaa;font-family:inherit;pointer-events:none;white-space:nowrap;z-index:10;transition:opacity 0.6s;';
hint.textContent = 'Drag to rotate · Click part to inspect · Scroll to zoom';
wrapper.appendChild(hint);

const btn = document.createElement('button');
btn.textContent = '💥 Explode';
btn.style.cssText = `position:absolute;top:12px;right:12px;z-index:10;
  background:rgba(18,58,41,0.88);color:#fff;border:1px solid rgba(255,255,255,0.2);
  border-radius:10px;padding:7px 14px;font-size:12px;font-family:inherit;cursor:pointer;backdrop-filter:blur(8px);`;
wrapper.appendChild(btn);

// ── Renderer ──────────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

const scene = new THREE.Scene();

// Camera looking straight at the front of the pendant
const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 100);
camera.position.set(0, 0.3, 5.5);
camera.lookAt(0, 0, 0);

function resize() {
  const w = wrapper.clientWidth || 400;
  const h = wrapper.clientHeight || 380;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ── Lights ────────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const key = new THREE.DirectionalLight(0xffffff, 2.5);
key.position.set(2, 4, 6);
key.castShadow = true;
key.shadow.mapSize.setScalar(2048);
scene.add(key);

const fill = new THREE.DirectionalLight(0xaaccff, 1.0);
fill.position.set(-4, 1, -2);
scene.add(fill);

const rim = new THREE.DirectionalLight(0x88ffcc, 0.6);
rim.position.set(0, -2, -4);
scene.add(rim);

// ── Controls ──────────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 2.5;
controls.maxDistance = 10;
controls.target.set(0, 0, 0);

// ── Root group ────────────────────────────────────────────────────────────────
const root = new THREE.Group();
scene.add(root);

// ── Materials ─────────────────────────────────────────────────────────────────
const M = {
  body:    new THREE.MeshStandardMaterial({ color: 0x1c2020, roughness: 0.20, metalness: 0.60 }),
  bodyBot: new THREE.MeshStandardMaterial({ color: 0x111515, roughness: 0.30, metalness: 0.50 }),
  bezel:   new THREE.MeshStandardMaterial({ color: 0x2a3030, roughness: 0.15, metalness: 0.80 }),
  sosCap:  new THREE.MeshStandardMaterial({ color: 0x222828, roughness: 0.10, metalness: 0.85 }),
  led:     new THREE.MeshStandardMaterial({ color: 0x00ff88, roughness: 0.05, metalness: 0.0, emissive: 0x00ff88, emissiveIntensity: 1.8 }),
  ledSlot: new THREE.MeshStandardMaterial({ color: 0x080c0c, roughness: 0.20, metalness: 0.90 }),
  spk:     new THREE.MeshStandardMaterial({ color: 0x0a0f0f, roughness: 0.70, metalness: 0.10 }),
  pcb:     new THREE.MeshStandardMaterial({ color: 0x1e521e, roughness: 0.55, metalness: 0.30 }),
  chip:    new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.20, metalness: 0.90 }),
  bat:     new THREE.MeshStandardMaterial({ color: 0xc8a018, roughness: 0.40, metalness: 0.20 }),
  strap:   new THREE.MeshStandardMaterial({ color: 0x0f1313, roughness: 0.90, metalness: 0.0 }),
  clip:    new THREE.MeshStandardMaterial({ color: 0x303c3c, roughness: 0.15, metalness: 0.95 }),
  usb:     new THREE.MeshStandardMaterial({ color: 0x252e2e, roughness: 0.25, metalness: 0.90 }),
};

// ── Part registry ─────────────────────────────────────────────────────────────
const parts = [];
const origMats = new Map();

function reg(mesh, name, desc, explodeDir) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { name, desc };
  root.add(mesh);
  origMats.set(mesh, mesh.material);
  parts.push({ mesh, name, desc, home: mesh.position.clone(), dir: new THREE.Vector3().copy(explodeDir) });
}

// ── Pendant dimensions ────────────────────────────────────────────────────────
// Real: 38mm W, 52mm H, 16mm D — scale: 1 unit ≈ 20mm
// Half-extents: W=0.95, H=1.30, D=0.40
const W = 0.95, H = 1.30, D = 0.40;

// ── Body: scale a sphere to egg-pendant shape ─────────────────────────────────
const sphereGeo = new THREE.SphereGeometry(1, 80, 80);

const frontBody = new THREE.Mesh(sphereGeo, M.body);
frontBody.scale.set(W, H, D);
frontBody.position.set(0, 0, 0);
reg(frontBody, 'Casing Depan', 'Polimer keras anti-bentur. Dimensi nyata: 38×52×16mm.', new THREE.Vector3(0, 0, 1.5));

// Back cover — very slightly smaller so it's visible
const backBody = new THREE.Mesh(sphereGeo, M.bodyBot);
backBody.scale.set(W * 0.98, H * 0.98, D * 0.65);
backBody.position.set(0, 0, -D * 0.30);
reg(backBody, 'Casing Belakang', 'Tutup belakang. Berisi port USB Type-C untuk pengisian daya.', new THREE.Vector3(0, 0, -1.8));

// ── SOS Button ────────────────────────────────────────────────────────────────
// Positioned on the upper-center of the front face
const sosY = H * 0.15; // slightly above centre
const sosZ = D * 0.98; // on the front surface

// Bezel ring
const bezelGeo = new THREE.CylinderGeometry(0.40, 0.40, 0.06, 64);
const bezel = new THREE.Mesh(bezelGeo, M.bezel);
bezel.rotation.x = Math.PI / 2;
bezel.position.set(0, sosY, sosZ);
root.add(bezel);

// Cap
const capGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.08, 64);
const sosCap = new THREE.Mesh(capGeo, M.sosCap);
sosCap.rotation.x = Math.PI / 2;
sosCap.position.set(0, sosY, sosZ + 0.055);

// Label texture
const tc = document.createElement('canvas');
tc.width = 256; tc.height = 256;
const ctx = tc.getContext('2d');
ctx.fillStyle = '#222828';
ctx.fillRect(0, 0, 256, 256);
ctx.fillStyle = '#c0c8c8';
ctx.font = 'bold 74px Arial';
ctx.textAlign = 'center';
ctx.textBaseline = 'middle';
ctx.fillText('SOS', 128, 128);
const sosTop = new THREE.Mesh(
  new THREE.CircleGeometry(0.34, 64),
  new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(tc), roughness: 0.08, metalness: 0.7 })
);
sosTop.position.set(0, sosY, sosZ + 0.095);
root.add(bezel);
root.add(sosTop);
reg(sosCap, 'Tombol SOS', 'Tekan tahan 3 detik → sinyal darurat via LoRa & GPS ke petugas desa.', new THREE.Vector3(0, 0.5, 2.0));

// ── LED indicator bar ─────────────────────────────────────────────────────────
const ledY = H * 0.80;
const ledSlot = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.08, 0.048), M.ledSlot);
ledSlot.position.set(0, ledY, D * 0.95);
root.add(ledSlot);

const led = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.046, 0.030), M.led);
led.position.set(0, ledY, D * 0.97);
reg(led, 'LED Indikator', '🟢 Normal  🟡 Baterai lemah  🔴 Darurat aktif', new THREE.Vector3(0, 1.2, 1.2));

// ── Clip at top ───────────────────────────────────────────────────────────────
const clip = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.044, 18, 48, Math.PI * 1.45), M.clip);
clip.position.set(0, H + 0.04, 0);
clip.rotation.z = Math.PI * 0.28;
reg(clip, 'Kait Kalung', 'Stainless steel anti-karat. Sambungan pivot ke tali nilon.', new THREE.Vector3(0, 1.5, 0));

// ── Neck straps ───────────────────────────────────────────────────────────────
const mkStrap = (sign) => {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(sign * 0.06, H + 0.1, 0),
    new THREE.Vector3(sign * 0.28, H + 0.6, -0.05),
    new THREE.Vector3(sign * 0.55, H + 1.4, -0.12),
  ]);
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.032, 8, false), M.strap);
  m.castShadow = true;
  return m;
};
const strapL = mkStrap(-1);
reg(strapL, 'Tali Kalung', 'Tali nilon elastis adjustable. Nyaman dipakai sepanjang hari.', new THREE.Vector3(-1.0, 0.5, 0));
root.add(mkStrap(1)); // right strap — no separate interactivity

// ── Speaker dots ──────────────────────────────────────────────────────────────
const spkGrp = new THREE.Group();
[[0,0],[-0.07,0],[0.07,0],[-0.035,-0.068],[0.035,-0.068]].forEach(([x,y]) => {
  const d = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.042, 10), M.spk);
  d.rotation.x = Math.PI / 2;
  d.position.set(x, y, D * 0.97);
  spkGrp.add(d);
});
spkGrp.position.set(0, -H * 0.42, 0);
root.add(spkGrp);

// Invisible proxy for raycasting speakers
const spkProxy = new THREE.Mesh(
  new THREE.BoxGeometry(0.28, 0.22, 0.08),
  new THREE.MeshStandardMaterial({ transparent: true, opacity: 0 })
);
spkProxy.position.set(0, -H * 0.42, D * 0.94);
reg(spkProxy, 'Speaker / Buzzer', 'Suara alarm hingga 85dB. Aktif saat peringatan bencana dari server desa.', new THREE.Vector3(0, -1.2, 1.2));

// ── USB port ──────────────────────────────────────────────────────────────────
const usb = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.13, 0.09), M.usb);
usb.position.set(0, -H * 0.88, -D * 1.0);
reg(usb, 'Port USB Type-C', 'Pengisian 500mAh dalam ~1 jam. Update firmware OTA via kabel.', new THREE.Vector3(0, -1.2, -1.5));

// ── PCB ───────────────────────────────────────────────────────────────────────
const pcb = new THREE.Mesh(new THREE.BoxGeometry(1.38, 1.72, 0.055), M.pcb);
pcb.position.set(0, 0, 0);
[[-0.36,0.44],[0.30,0.18],[-0.16,-0.30],[0.36,-0.50]].forEach(([x,y]) => {
  const c = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.13, 0.052), M.chip);
  c.position.set(x, y, 0.052);
  pcb.add(c);
});
reg(pcb, 'PCB & ESP32-C3', 'Mikrokontroler utama: GPS GNSS, LoRa 868MHz, BLE, sensor gerak, real-time alert.', new THREE.Vector3(0, 0, 2.2));

// ── Battery ───────────────────────────────────────────────────────────────────
const bat = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.72, 0.11), M.bat);
bat.position.set(0, -H * 0.38, 0);
reg(bat, 'Baterai Li-Po 500mAh', 'Tahan 3–5 hari pemakaian normal. Isi ulang via USB Type-C.', new THREE.Vector3(0, -1.5, 2.2));

// ── Interaction state ─────────────────────────────────────────────────────────
let exploded = false;
let selected = null;

const HIGHLIGHT = new THREE.MeshStandardMaterial({
  color: 0x22cc88, roughness: 0.1, metalness: 0.4, emissive: 0x00cc66, emissiveIntensity: 0.40
});

function lerpTo(vec, target, ms) {
  const from = vec.clone(); const t0 = performance.now();
  const step = (now) => {
    const t = Math.min((now - t0) / ms, 1);
    const e = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    vec.lerpVectors(from, target, e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function setExploded(val) {
  exploded = val;
  btn.textContent = val ? '🔗 Assemble' : '💥 Explode';
  parts.forEach(p => {
    lerpTo(p.mesh.position, val ? p.home.clone().addScaledVector(p.dir, 1.8) : p.home.clone(), 700);
  });
}

function selectPart(part) {
  if (selected) {
    const om = origMats.get(selected.mesh);
    if (om) selected.mesh.material = om;
  }
  if (selected === part) { selected = null; info.style.opacity = '0'; return; }
  selected = part;
  selected.mesh.material = HIGHLIGHT;
  info.innerHTML = `<b style="font-size:14px">${part.name}</b><br><span style="color:#555;font-size:12px">${part.desc}</span>`;
  info.style.opacity = '1';
}

// ── Raycasting ────────────────────────────────────────────────────────────────
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();

canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  mouse.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(parts.map(p => p.mesh), true);
  if (!hits.length) return;
  const obj = hits[0].object;
  const part = parts.find(p => p.mesh === obj || p.mesh.children.includes(obj));
  if (!part) return;
  if (!exploded) setExploded(true);
  selectPart(part);
});

canvas.addEventListener('pointerdown', () => { canvas.style.cursor = 'grabbing'; });
canvas.addEventListener('pointerup',   () => { canvas.style.cursor = 'grab'; });
btn.addEventListener('click', () => {
  setExploded(!exploded);
  if (!exploded) { selected = null; info.style.opacity = '0'; }
});

// ── Auto rotate ───────────────────────────────────────────────────────────────
let autoRot = true;
controls.addEventListener('start', () => { autoRot = false; hint.style.opacity = '0'; });

let ledT = 0;
new ResizeObserver(resize).observe(wrapper);
resize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (autoRot) root.rotation.y += 0.004;
  ledT += 0.04;
  M.led.emissiveIntensity = 0.9 + 0.7 * Math.sin(ledT);
  renderer.render(scene, camera);
}
animate();
