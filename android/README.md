# JAGA Android

Aplikasi Android menjalankan frontend JAGA yang sama dengan web di dalam WebView terlindungi. Seluruh menu, role, pembatasan akses, dan alur kerja JAGA Pusat/Desa/Rescue selalu identik dengan versi web; tidak ada logika bisnis web yang tertinggal di mobile. Kode native tetap menyediakan fondasi untuk integrasi perangkat di masa depan.

- `data/model`: model API murni.
- `data/remote`: HTTP client dan parsing respons backend.
- `data/local`: penyimpanan sesi terenkripsi.
- `data/repository`: batas antara network dan UI.
- `ui`: state holder, tema, dan composable layar.

## Menjalankan

Gunakan JDK 17 dan Android SDK API 34. Debug membuka `http://10.0.2.2:3000`, sementara release membuka endpoint HTTPS Railway dari `BuildConfig.WEB_BASE`. Cleartext hanya tersedia untuk host emulator/lokal dalam konfigurasi jaringan.

```powershell
cd android
.\gradlew.bat :app:assembleDebug
```

Atau dari akar repository: `npm run android:assemble`. Jangan menaruh token, endpoint privat, atau kunci perangkat di source code.
