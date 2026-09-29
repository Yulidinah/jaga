oke jadi ini aku bakal coba elaborasi ya sistem kita jadi sistem kita ada dua objek utama:

1. JAGA (Software)
2. JAGA Rumah (Hardware)

fitur di tiap objek:

1. JAGA Pusat:

* Pendataan warga disabilitas dengan triangle mulai dari desa lalu ke provinsi lalu ke nasional jadi dari desa lalu ke nasional yang utama tetap desa jadi sata nya terintegrasi.
* Role: JAGA Pusat, JAGA Desa, JAGA JAGA Rescue.
* lalu fitur yang menungkinkan admin menyalakan alaram di tiap rumah yang di install ke tiap rumah disabilitas untuk evakuasi.
* kemudian tiap peminimpin atau penanggung jawab dari JAGA Pusat dapat melihat data disabilitas di desa yang sudah di selamatkan jadi pemantauan disabilitas jadi lebih aware, yang mana mereka sering terlupakan dan memang harus mendapatkan perhatian khusu saat bencana.
* FItur menghubungi JAGA Rescue saat bencana.


2.  JAGA Rumah:

* Hardware yang berfungsi sebagai alaram unutuk rumah disabilitas dengan memberikan sinyal berupa suara, cahaya, dan getaran.
* lalu menggunakan LoRa dan baterai yang hemat karena hanya bekerja saat di aktifkan oleh tim JAGA Pusat.


3. JAGA Rescue:

* aplikasi yang sama yaitu JAGA tapi dengan role rescue atau sebagai tim penyelamat seperti damkar, tim SAR, dan organisasi kemanusiaan lainnya.
* lalu fitur map terintegrasi yang mempermudah tim rescue untuk locate rumah prioritas untuk di selamatkan.
* sistem pelacakan jejak pencarian untuk mempermudah tim penyelamat dalam tracking rute yang sudah mereka lalui sehingga mempermudah dan lebih efektif.
* kemudian saran rute penyelamatan tercepat dan efektif, sehingga jika di pedalaman ada rumah yang terisolasi jadi mudah di data. kemudian ada daerah yang rawan dan sulit di akses juga akan di highlight dengan warna merah, orange,  kuning.


jadi gimana menurut mu?

---

# Alur Operasional JAGA

## Prinsip pengambilan keputusan

JAGA adalah sistem pendukung keputusan, bukan pengganti keputusan petugas. Sistem
menyediakan informasi warga, kondisi kerentanan, lokasi, kondisi bahaya, status
perangkat, serta rekomendasi urutan penanganan yang dapat dijelaskan.

Pembagian tanggung jawab:

- **JAGA Desa** bertanggung jawab memutakhirkan data warga dan kondisi lokal,
  memvalidasi rekomendasi awal sistem, mengaktifkan peringatan, serta meminta
  bantuan Rescue.
- **Komandan JAGA Rescue** bertanggung jawab atas keputusan taktis dan urutan
  pelaksanaan evakuasi di lapangan berdasarkan kondisi nyata dan keselamatan tim.
- **JAGA Pusat** menetapkan standar dan konfigurasi aturan dasar, mengawasi
  operasi, serta mengevaluasi hasil dan audit keputusan.
- **Sistem JAGA** menghitung rekomendasi secara transparan, menampilkan alasan,
  memperbarui rekomendasi ketika kondisi berubah, dan mencatat setiap keputusan.

Petugas berwenang dapat mengubah rekomendasi sistem. Setiap perubahan wajib
disertai alasan dan disimpan dalam log audit. Jenis disabilitas tidak boleh menjadi
satu-satunya penentu. Penilaian mempertimbangkan kemampuan evakuasi mandiri,
kondisi bahaya terbaru, kebutuhan bantuan, keberadaan pendamping, akses lokasi,
dan sumber daya Rescue.

## Flowchart Input–Process–Output

```mermaid
flowchart LR
    subgraph INPUT[INPUT]
        I1[Data profil dan kebutuhan warga]
        I2[Lokasi warga dan zona bahaya]
        I3[Status JAGA Rumah dan gateway]
        I4[SOS dan laporan kondisi terbaru]
        I5[Posisi, kapasitas, dan perlengkapan Rescue]
        I6[Aturan yang disahkan JAGA Pusat]
    end

    subgraph PROCESS[PROCESS]
        P1[Validasi identitas, wilayah, dan hak akses]
        P2[Hubungkan warga, kebutuhan, perangkat, dan lokasi]
        P3[Analisis indikator bahaya dan kebutuhan bantuan]
        P4[Buat rekomendasi beserta alasan]
        P5[Validasi JAGA Desa]
        P6[Keputusan taktis JAGA Rescue]
        P7[Pembaruan status dan perhitungan ulang]
        P8[Catat riwayat dan audit]
    end

    subgraph OUTPUT[OUTPUT]
        O1[Informasi warga dan kebutuhan bantuan]
        O2[Peta situasi dan status perangkat]
        O3[Rekomendasi urutan penanganan]
        O4[Penugasan tim dan rute operasi]
        O5[Status evakuasi dan keselamatan warga]
        O6[Laporan nasional dan bahan evaluasi]
    end

    I1 --> P1
    I2 --> P2
    I3 --> P2
    I4 --> P3
    I5 --> P3
    I6 --> P3
    P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7 --> P8
    P2 --> O1
    P3 --> O2
    P4 --> O3
    P6 --> O4
    P7 --> O5
    P8 --> O6
```

## Flowchart logic JAGA Pusat

```mermaid
flowchart TD
    A[JAGA Pusat login] --> B[Dashboard nasional]
    B --> C{Pilih kegiatan}

    C -->|Tata kelola| D[Kelola standar data dan aturan rekomendasi]
    D --> E[Uji dan tinjau konfigurasi]
    E --> F[Publikasikan versi aturan]
    F --> G[Aturan berlaku untuk wilayah yang ditentukan]

    C -->|Monitoring| H[Lihat ringkasan provinsi, kabupaten, dan desa]
    H --> I[Lihat alarm, SOS, perangkat, dan status evakuasi]
    I --> J{Ada masalah sistemik?}
    J -->|Ya| K[Koordinasi dengan Desa atau organisasi Rescue]
    J -->|Tidak| L[Lanjutkan pemantauan]

    C -->|Evaluasi| M[Lihat audit keputusan dan hasil operasi]
    M --> N[Analisis waktu respons, kegagalan alarm, dan kendala akses]
    N --> O[Susun perbaikan kebijakan dan kesiapsiagaan]

    C -->|Manajemen akses| P[Kelola organisasi dan administrator wilayah]
    P --> Q[Catat perubahan dalam audit log]

    G --> Q
    K --> Q
    O --> Q
```

JAGA Pusat tidak memilih warga yang dievakuasi satu per satu. Pusat mengatur
standar, cakupan akses, pengawasan, dan evaluasi lintas wilayah.

## Flowchart logic JAGA Desa

```mermaid
flowchart TD
    A[JAGA Desa login] --> B[Periksa data warga dan perangkat]
    B --> C{Ada perubahan data?}
    C -->|Ya| D[Perbarui kebutuhan, pendamping, lokasi, atau perangkat]
    C -->|Tidak| E[Pantau kondisi wilayah]
    D --> E

    E --> F{Ancaman terdeteksi?}
    F -->|Tidak| G[Pemantauan dan simulasi berkala]
    F -->|Ya| H[Verifikasi informasi lapangan]
    H --> I[Pilih tingkat peringatan dan target]
    I --> J[Konfirmasi pengiriman alarm]
    J --> K[Sistem mengirim ke JAGA Rumah]
    K --> L[Pantau perangkat menerima atau gagal]

    L --> M{SOS atau laporan bantuan masuk?}
    M -->|Tidak| N[Perbarui kondisi dan terus memantau]
    M -->|Ya| O[Buka profil kebutuhan warga dan situasi lokasi]
    O --> P[Sistem menampilkan rekomendasi dan alasan]
    P --> Q{Rekomendasi sesuai kondisi lokal?}
    Q -->|Ya| R[Validasi rekomendasi awal]
    Q -->|Tidak| S[Ubah rekomendasi dan isi alasan]
    R --> T[Hubungi dan kerahkan JAGA Rescue]
    S --> T
    T --> U[Pantau penugasan dan status warga]
    U --> V[Konfirmasi warga aman atau perlu tindak lanjut]
    V --> W[Tutup kejadian bersama Rescue]

    N --> M
```

JAGA Desa bertanggung jawab atas keakuratan informasi lokal dan keputusan awal,
tetapi keputusan taktis di lokasi operasi tetap berada pada komandan Rescue.

## Flowchart logic JAGA Rescue

```mermaid
flowchart TD
    A[JAGA Rescue login] --> B[Terima permintaan bantuan dan daftar SOS]
    B --> C[Lihat data kebutuhan warga, peta, bahaya, dan akses]
    C --> D[Lihat rekomendasi sistem beserta alasannya]
    D --> E[Komandan menilai situasi dan keselamatan tim]
    E --> F{Rekomendasi dapat dijalankan?}
    F -->|Ya| G[Konfirmasi urutan operasi]
    F -->|Tidak| H[Ubah urutan dan isi alasan]
    G --> I[Pilih dan tugaskan tim]
    H --> I

    I --> J[Tim menerima profil bantuan dan rute]
    J --> K[Status: menuju lokasi]
    K --> L{Kondisi berubah?}
    L -->|Ya| M[Perbarui bahaya, akses, dan kondisi warga]
    M --> E
    L -->|Tidak| N[Tim tiba di lokasi]

    N --> O[Konfirmasi identitas dan kondisi warga]
    O --> P[Lakukan bantuan atau evakuasi]
    P --> Q[Perbarui status warga]
    Q --> R{Warga sudah aman?}
    R -->|Belum| S[Koordinasikan bantuan tambahan]
    S --> P
    R -->|Ya| T[Catat lokasi aman dan hasil operasi]
    T --> U[Selesaikan penugasan]
```

Rescue berhak mengubah urutan karena kondisi lapangan dapat berbeda dari data
sistem. Sistem wajib menyimpan siapa yang mengubah, waktu perubahan, dan
alasannya.

## Flowchart logic warga pemegang kalung SOS

```mermaid
flowchart TD
    A[Warga menerima peringatan] --> B{Media peringatan aktif}
    B --> C[Suara]
    B --> D[Cahaya]
    B --> E[Getaran]
    C --> F[Warga atau pendamping memahami peringatan]
    D --> F
    E --> F

    F --> G{Dapat melakukan evakuasi mandiri?}
    G -->|Ya| H[Ikuti prosedur menuju lokasi aman]
    G -->|Tidak| I[Tekan tombol SOS]
    I --> J[JAGA Rumah mengirim ID perangkat dan status]
    J --> K[Gateway LoRa meneruskan ke backend]
    K --> L[Sistem menghubungkan perangkat dengan profil warga]
    L --> M[SOS tampil pada JAGA Desa dan Rescue]
    M --> N[Perangkat menerima konfirmasi SOS diterima]

    N --> O{Ada pembaruan kondisi?}
    O -->|Ya| P[Warga atau pendamping memberikan informasi terbaru]
    P --> Q[Sistem memperbarui informasi operasi]
    Q --> O
    O -->|Tidak| R[Menunggu bantuan sesuai prosedur aman]
    R --> S[Tim Rescue tiba]
    S --> T[Evakuasi atau bantuan di tempat]
    T --> U[Warga dikonfirmasi aman]

    H --> U
```

Jika jaringan internet terputus, komunikasi JAGA Rumah tetap dirancang melalui
LoRa menuju gateway. Perangkat perlu memberi umpan balik yang dapat dipahami
warga—misalnya pola cahaya atau getaran—ketika SOS sudah terkirim dan diterima.
