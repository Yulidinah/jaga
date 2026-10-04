// Mencetak ID dan kunci kalung/gateway DEMO (mode memori) agar tim perangkat bisa menguji API tanpa Supabase.
// Kunci ini diturunkan dari seed publik dan hanya berlaku pada data dummy; kunci produksi dibuat saat perangkat didaftarkan.
//   npm run build && node scripts/demo-device-keys.mjs
import { buildDemoData } from "../backend/dist/seed.js";

const demo = buildDemoData();
const devices = demo.tables.devices.filter(d => d.status === "ASSIGNED");
console.log("KALUNG DEMO (header X-JAGA-Device-Id / X-JAGA-Device-Key)");
for (const { deviceId, key } of demo.deviceKeys) {
  const device = devices.find(d => d.id === deviceId);
  if (device) console.log(`  ${deviceId}  ${key}  (${device.owner_name})`);
}
console.log("\nGATEWAY DEMO (header X-JAGA-Gateway-Key, opsional)");
for (const { gatewayId, key } of demo.gatewayKeys) console.log(`  ${gatewayId}  ${key}`);
