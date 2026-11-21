# Changelog

Semua perubahan penting pada proyek **KAIStream** didokumentasikan di berkas ini. Format penulisan mengacu pada [Keep a Changelog](https://keepachangelog.com/id/1.1.0/) dan mengikuti standar [Semantic Versioning](https://semver.org/lang/id/).

## [0.1.1] - 2026-11-21

### Ditambahkan
- **Lapisan Fasilitas Dipo & Balai Yasa:** Menambahkan 58 lokasi fasilitas sarana perkeretaapian di seluruh Pulau Jawa (Dipo Lokomotif, Dipo Kereta, Dipo KRL Commuter Line, Balai Yasa, dan Depo Whoosh Tegalluar) lengkap dengan panel detail informasi kota, kapasitas, dan wilayah operasi.
- **Visualisator Susunan Rangkaian Kereta (Consist Visualizer):** Menampilkan diagram visual susunan gerbong nyata dan nomor lokomotif dinas (CC206, CC203, CC201, dll.) pada panel detail kereta.
- **Pusat Informasi Gangguan Operasional Mandiri:** Integrasi data rintang jalan, pekerjaan jalur, dan info lintas operasional yang berdiri sendiri tanpa dependensi API eksternal.
- **Navigasi Riwayat Kembali (Back Stack):** Tombol Kembali pada panel detail yang merekam jejak pemilihan pengguna antar kereta, stasiun, dipo, dan panel penjelajah.

### Diubah
- **Desain & Tata Letak Header Panel Detail:**
  - Memindahkan tombol Kembali ke kluster aksi sisi kanan (`.panel-header-actions`), sejajar dengan tombol sembunyikan/tampilkan dan tombol tutup.
  - Menghilangkan latar belakang kotak tombol (`background: transparent; border: 0;`) untuk tampilan yang lebih bersih dan modern.
  - Mengganti seluruh tombol teks Tutup dengan ikon SVG silang proporsional (`✕`) di seluruh panel (Detail, Explorer, Time Machine), dialog modal (Sumber Data, Warta Lintas), dan bilah pencarian.
  - Mengganti tombol Peta dengan ikon SVG chevron ganda vertikal atas-bawah (`<>`) untuk toggle panel.

### Diperbaiki
- **Stabilitas Zoom Kamera Peta:** Memperbaiki bug kamera yang melakukan zoom out otomatis ke level 9.2 saat pengguna memilih kereta di posisi zoom dekat. Posisi zoom pengguna kini tetap dipertahankan (`Math.max(currentZoom, cameraTarget.zoom)`).
- **Alur Sinkronisasi Harian GitHub Actions:** Memperbaiki kegagalan job `Sync Java Rail Data Daily` akibat `PermissionError` saat membaca direktori lokal di lingkungan non-root runner, dengan menerapkan mekanisme fallback otomatis ke repositori GTFS resmi daring.
- **Perekaman Riwayat Penjelajah:** Memperbaiki integrasi stack riwayat navigasi saat pengguna memilih item dari panel Explorer.

## [0.1.0] - 2026-11-20

### Ditambahkan
- **Rilis Perdana KAIStream:** Platform peta atlas interaktif dan simulasi deterministik pergerakan kereta api seluruh Pulau Jawa berbasis jadwal resmi GAPEKA di zona waktu WIB (UTC+7).
- **Integrasi Jaringan Rel Nasional & Cepat:**
  - Jaringan 1067 mm PT KAI di 6 provinsi Jawa (Antarkota, KRL Commuter Line, KA Bandara, KA Lokal).
  - Jaringan 1435 mm Kereta Cepat Whoosh PT KCIC rute Halim sampai Tegalluar Summarecon dengan visualisasi jalur layang khusus merah.
- **Mesin Simulasi 60 FPS:** Posisi, kecepatan, dan sudut hadap dihitung secara matematis dengan interpolasi polilin berbobot jarak serta 13.215 titik lintas langsung (Ls).
- **Navigasi Waktu (Time Machine):** Kontrol kecepatan simulasi (1x hingga 120x) dan penggeser waktu 24 jam dengan filter hari kerja/akhir pekan.
- **Perencana Rute & Pencarian:** Perencana perjalanan langsung dan transit 1 kali transit untuk seluruh stasiun di Pulau Jawa.
- **Peta Dasar & Cuaca:** 3 pilihan basemap (Standar, Satelit, Topografi), overlay live radar hujan RainViewer API, dan dukungan permalink URL lengkap.
