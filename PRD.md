# PRODUCT REQUIREMENTS DOCUMENT (PRD)

**KAIStream: Railway Live Tracking Indonesia (Pulau Jawa)**

- **Nama Proyek:** KAIStream (Railway Live Tracking Java)
- **Tipe Produk:** Platform Visualisasi dan Simulasi Jaringan Perkeretaapian Interaktif
- **Cakupan Geografis:** Khusus Pulau Jawa, Indonesia (terkunci pada 6 provinsi di Pulau Jawa)
- **Status Dokumen:** Spesifikasi Produk v1.1 (Siap Implementasi)
- **Versi:** 1.1

---

## 1. PRODUCT OVERVIEW

### 1.1 Deskripsi Produk

KAIStream (Railway Live Tracking Java) adalah platform visualisasi jaringan kereta api di Pulau Jawa yang memungkinkan pengguna memantau seluruh aktivitas perjalanan kereta penumpang pada satu peta kartografi interaktif.

Platform menampilkan peta yang dikunci khusus pada wilayah Pulau Jawa, geometri jaringan rel kereta api sebenarnya, lokasi stasiun, serta animasi pergerakan marker kereta yang dihitung berdasarkan jadwal perjalanan dan estimasi waktu tempuh antar stasiun.

Pengguna dapat memantau pergerakan kereta secara visual, mencari kereta atau stasiun tertentu, melihat progres rute perjalanan, memeriksa daftar pemberhentian serta stasiun berikutnya, dan menjelajahi aktivitas perkeretaapian lintas waktu melalui fitur Time Machine.

### 1.2 Konsep Utama

- Peta geografis khusus Pulau Jawa (pengguna tidak dapat menggeser atau memperkecil peta ke pulau atau negara lain).
- Visualisasi jaringan jalur rel kereta api sesuai lintasan geografis OpenStreetMap.
- Marker kereta terarah yang bergerak mengikuti geometri rel dan arah tempuh.
- Posisi kereta dihitung secara deterministik berdasarkan jadwal referensi.
- Animasi pergerakan kereta berkelanjutan berbasis interpolasi jarak sepanjang rel dengan kurva akselerasi/deselerasi halus.
- Panel detail perjalanan kereta dan jadwal aktivitas stasiun.
- Simulasi Time Machine lintas jam dengan pilihan kecepatan, jeda, dan pola hari operasional.

### 1.3 Prinsip Keakuratan Data

Produk menggunakan pendekatan **timetable-based simulation** dengan zona waktu tunggal **WIB (Asia/Jakarta, UTC+7)**. Posisi kereta bukan berasal dari pelacakan GPS aktual milik operator kereta api.

Posisi dihitung berdasarkan:

1. Waktu keberangkatan dari stasiun sebelumnya.
2. Waktu kedatangan pada stasiun berikutnya.
3. Jadwal tiba dan berangkat pada setiap stasiun pemberhentian.
4. Geometri jalur rel yang sudah diprakomputasi (termasuk titik lewat langsung / *Ls* untuk mengunci lintas Utara vs Selatan).
5. Panjang lintasan kumulatif antar stasiun.
6. Waktu simulasi WIB yang sedang berjalan.

Antarmuka wajib membedakan secara tegas antara **Jadwal Referensi** dan **Hasil Simulasi Saat Ini**, serta mencantumkan keterangan bahwa data bersifat simulasi jadwal, bukan pelacakan GPS aktual dan tidak berafiliasi dengan PT Kereta Api Indonesia (Persero).

---

## 2. PRODUCT OBJECTIVES

1. Membangun visualisasi jaringan kereta api Pulau Jawa dalam satu peta interaktif yang terfokus.
2. Menampilkan pergerakan kereta penumpang berdasarkan pola jadwal perjalanan GAPEKA.
3. Menghadirkan antarmuka pemantauan kereta yang jelas, tenang, dan mudah dibaca di desktop, tablet, maupun ponsel.
4. Menyediakan informasi rute, status perjalanan, dan jadwal stasiun dalam satu platform.
5. Memungkinkan eksplorasi kepadatan dan aktivitas perjalanan kereta berdasarkan waktu simulasi.
6. Menjaga kualitas data melalui validasi otomatis jalur, stasiun, dan jadwal sebelum ditampilkan.

### 2.1 Target Pengguna

- Penggemar kereta api Indonesia (railfans).
- Calon penumpang dan komuter kereta api di Pulau Jawa.
- Pengamat dan peneliti transportasi perkeretaapian.
- Pengembang aplikasi mobilitas dan masyarakat umum.

---

## 3. GEOGRAPHICAL COVERAGE DAN PENGUNCIAN PETA JAWA

### 3.1 Wilayah Utama

Cakupan peta dikunci secara ketat pada Pulau Jawa, meliputi 6 provinsi:

- Banten
- DKI Jakarta
- Jawa Barat
- Jawa Tengah
- Daerah Istimewa Yogyakarta
- Jawa Timur

### 3.2 Aturan Penguncian Peta Khusus Pulau Jawa

Agar fokus aplikasi tetap pada jaringan kereta Pulau Jawa:

- **Pembatasan Batas Geser (`maxBounds`):** Kamera peta dibatasi pada koordinat Pulau Jawa (`lon 104.90` s.d. `114.75`, `lat -8.98` s.d. `-5.68`). Pengguna tidak dapat menggeser peta keluar ke Sumatera, Kalimantan, Bali, atau wilayah lain.
- **Pembatasan Zoom Minimum (`minZoom` dinamis):** Nilai `minZoom` dihitung menyesuaikan ukuran layar pengguna (minimal `5.8` pada ponsel dan `6.5` pada desktop) sehingga peta tidak dapat diperkecil keluar dari Pulau Jawa.
- **Masking Kartografi Luar Jawa:** Wilayah geografis di luar daratan Pulau Jawa ditutup dengan lapisan masker kartografi bersih agar Sumatera bagian selatan, Bali bagian barat, dan perairan sekitarnya tidak mengganggu fokus visual jaringan rel Jawa.
- **Tombol Reset Pulau Jawa:** Tersedia kontrol satu klik untuk mengembalikan kamera tepat ke seluruh rentang Pulau Jawa.

### 3.3 Cakupan Operator dan Kategori Jalur

Fokus versi 1.0 adalah jaringan rel **1067 mm operasional penumpang KAI / KAI Commuter / KAI Bandara** di Pulau Jawa:

- **Antarkota (KAJJ):** Jalur utama Lintas Utara (Pantura), Lintas Tengah/Selatan, serta penghubung antardaerah Jawa Barat, Jawa Tengah, DIY, dan Jawa Timur.
- **Commuter Line:** Jaringan KRL Jabodetabek, KRL Yogyakarta-Solo-Palur, serta koridor komuter Bandung Raya dan Surabaya-Malang/Blitar.
- **Lokal:** Jalur KA lokal regional (Merak, Pangrango, Siliwangi, Prameks, Kedung Sepur / Blora Jaya).
- **Bandara:** Jalur KA Bandara Soekarno-Hatta dan KA Bandara Yogyakarta International Airport (YIA).

Jalur nonaktif, jalur historis (seperti rel bergigi Ambarawa), jalur khusus barang, trem/LRT/MRT/subway, serta jalur kereta cepat (KCIC Whoosh) dipisahkan ke kategori `non_operational` dan **tidak ditampilkan** secara default. Pengguna dapat menyalakannya melalui panel Lapisan dengan gaya garis putus-putus yang dibedakan secara jelas.

### 3.4 Data Geografis

Setiap segmen jalur dan stasiun memiliki:

- Geometri poliline jalur rel dari OpenStreetMap.
- Koordinat geografis tervalidasi berada di dalam batas Pulau Jawa.
- Identitas segmen, kategori jalur, dan status operasional (`operational: true/false`).
- Keterhubungan graf topologi untuk perhitungan rute terpendek antar stasiun pada jaringan rel aktif.

---

## 4. CORE FEATURES

### 4.1 Interactive Railway Map

Peta memenuhi area utama layar dengan kontrol terintegrasi:

- Fokus penuh Pulau Jawa dengan dukungan pan, zoom, dan tombol Reset Pulau Jawa.
- Lapisan batas 6 provinsi Pulau Jawa yang dapat dinyalakan atau dimatikan.
- Penampilan jalur rel dan label stasiun yang beradaptasi terhadap tingkat zoom (LOD).
- Dukungan tema Terang (Atlas Kartografi, default) dan tema Gelap (Mode Peta Malam) yang berfungsi penuh.
- Tata letak responsif khusus untuk Desktop, Tablet, dan Ponsel.

### 4.2 Railway Network Visualization

- Jalur mengikuti geometri rel sesungguhnya, bukan garis lurus antar stasiun.
- Pemisahan tegas antara **Display Geometry** (seluruh segmen rel untuk rendering peta) dan **Topological Routing Graph** (graf terhubung untuk menghitung poliline rute setiap perjalanan kereta).
- Percabangan serta koridor Lintas Utara dan Lintas Selatan dipisahkan melalui titik pengunci rute (*passing waypoints*).
- Kategori jalur (`Antarkota`, `Commuter`, `Lokal/Cabang`, `Non-Aktif/Non-KAI`) dapat diaktifkan atau dinonaktifkan secara independen pada tab Lapisan.

### 4.3 Animated Train Tracking

- Seluruh marker kereta dirender di GPU melalui WebGL (`symbol` layer MapLibre GL JS), bukan DOM HTML marker, agar tetap mulus pada 60 FPS.
- Setiap marker bergerak mengikuti geometri lintasan rel yang telah diprakomputasi.
- Arah ikon marker berputar otomatis mengikuti bearing sudut rel (`icon-rotate`), termasuk berbalik arah apabila segmen rute memutar balik.
- Pergeseran lateral kecil (*lateral offset*) diterapkan pada tingkat zoom tinggi agar kereta yang berpapasan pada arah berlawanan tidak bertumpuk tepat di satu titik.
- **Level of Detail (LOD) Kepadatan Jabodetabek:** Pada zoom seluruh Pulau Jawa (`z < 8.5`), marker kereta Commuter/Lokal berukuran lebih ringkas atau dapat difilter agar koridor padat Jabodetabek tetap terbaca tanpa menenggelamkan jalur antarkota.
- Marker berhenti tepat di koordinat stasiun selama waktu pemberhentian dan hilang/berubah status setelah melewati masa tiba selesai.
- Setiap marker dapat diklik untuk membuka panel informasi perjalanan.

### 4.4 Train Information

Saat pengguna memilih kereta, sistem menampilkan:

- Nomor perjalanan (KA) dan nama kereta.
- Kategori kereta (`Antarkota`, `Commuter`, `Lokal`, `Bandara`).
- Relasi stasiun asal dan stasiun tujuan.
- Stasiun sebelumnya dan stasiun berikutnya.
- **Jadwal Referensi:** jam berangkat asal, jam tiba tujuan, serta pola hari operasional.
- **Hasil Simulasi:** waktu simulasi WIB, status perjalanan, persentase progres tempuh, jarak tempuh dalam kilometer, serta estimasi kecepatan saat ini (`km/j`).
- Daftar urutan stasiun pemberhentian lengkap beserta waktu tiba, waktu berangkat, dan durasi berhenti.
- Kontrol aksi **Fokus Rute Ini** (mengisolasi jalur kereta terpilih) dan **Ikuti Kereta** (kamera mengikuti pergerakan kereta tetap di dalam batas Pulau Jawa).

### 4.5 Train Status (State Machine)

Setiap perjalanan memiliki definisi status tegas yang disertai warna, label teks, dan ikon bentuk (tidak bergantung pada warna saja):

- **`scheduled`:** Waktu simulasi lebih awal dari 15 menit sebelum keberangkatan awal.
- **`boarding`:** Berada pada rentang 15 menit sebelum jam keberangkatan awal.
- **`running`:** Kereta sedang bergerak pada segmen rel antar dua stasiun.
- **`stopping`:** Kereta sedang berhenti sesuai jadwal antara jam tiba dan jam berangkat di stasiun antara.
- **`arrived`:** Telah tiba di stasiun tujuan akhir (bertahan 10 menit setelah tiba agar tetap dapat diklik pengguna).
- **`completed`:** Lebih dari 10 menit setelah jam tiba akhir (tidak ditampilkan di peta).
- **`unknown`:** Data perjalanan gagal validasi (tidak pernah ditempatkan sembarangan di peta).

### 4.6 Station Information

Setiap stasiun memiliki:

- Nama stasiun, kode resmi 3 huruf KAI (jika tersedia), dan koordinat geografis.
- Kabupaten/kota dan provinsi di Pulau Jawa.
- Daftar kereta yang berhenti atau melintas melayani stasiun tersebut, diurutkan relatif terhadap waktu simulasi WIB saat ini.
- Klik pada jadwal kereta di panel stasiun langsung berpindah ke panel detail kereta tersebut.

### 4.7 Train Route Visualization

Saat sebuah kereta dipilih:

- Seluruh jalur rel perjalanan kereta tersebut digambar pada peta.
- Segmen yang **sudah dilalui** dan segmen yang **belum dilalui** dibedakan secara visual.
- Stasiun asal, stasiun pemberhentian antara, stasiun berikutnya, dan stasiun tujuan akhir ditandai di sepanjang rute.

---

## 5. SIMULATION ENGINE

### 5.1 Konsep Simulasi Deterministik

Mesin simulasi menghitung posisi seluruh kereta secara deterministik sebagai fungsi dari waktu simulasi (`simSeconds` dalam zona WIB) dan dataset jadwal statis. Simulasi tidak bergantung pada GPS dan tidak bergantung pada frame rate layar pengguna.

### 5.2 Perhitungan Posisi dan Kinematika

1. Cari segmen aktif pada waktu `simSeconds` (berhenti di stasiun atau bergerak antar stasiun `i` dan `i+1`).
2. Hitung rasio waktu tempuh linear `rawT = (simSeconds - dep_i) / (arr_{i+1} - dep_i)`.
3. Terapkan **kurva akselerasi dan deselerasi halus** (*trapezoidal/cubic ease* pada ~8% awal dan ~8% akhir segmen) agar kereta berakselerasi saat meninggalkan stasiun dan melambat menjelang berhenti.
4. Konversi progres ke jarak kilometer target `targetKm` sepanjang poliline rute.
5. Gunakan *binary search* pada array jarak kumulatif `cumDistKm` poliline untuk menginterpolasi koordinat `[lon, lat]` dan menghitung sudut arah `bearingDeg`.

### 5.3 Penanganan Lintas Tengah Malam

Jadwal menggunakan konvensi waktu **GTFS (> 24:00:00)** untuk kereta malam yang tiba keesokan harinya (misal berangkat `20:30`, tiba di stasiun antara pukul `25:15` untuk `01:15` hari berikutnya).

Saat mengevaluasi peta pada pukul `01:30 WIB`, mesin simulasi memeriksa sekaligus:

- Perjalanan hari berjalan (`simSeconds`), dan
- Sisa perjalanan lintas tengah malam dari hari sebelumnya (`simSeconds + 86400`).

### 5.4 Sinkronisasi dan Percepatan Waktu

Mendukung kontrol Play, Pause, lompat waktu langsung, dan kecepatan **0.5x, 1x, 2x, 5x, 10x, 20x**. Mengubah kecepatan atau menjeda simulasi tidak pernah menggeser posisi kereta untuk cap waktu simulasi yang sama.

---

## 6. TIME MACHINE

Time Machine memungkinkan pengguna menjelajahi aktivitas perkeretaapian berdasarkan jam dan pola hari operasional:

- Slider timeline horizontal 24 jam (`00:00` sampai `23:59 WIB`).
- Tombol cepat lompat waktu: `06:00`, `12:00`, `18:00`, `22:00`, serta tombol `Waktu Sekarang (WIB)`.
- Pemilih pola hari operasional (`Hari Kerja`, `Akhir Pekan`, `Semua Jadwal`) sesuai sifat jadwal referensi GAPEKA.
- Tombol Play/Pause dan pengatur kecepatan (`0.5x` s.d. `20x`).

---

## 7. SEARCH & FILTER

### 7.1 Pencarian

Pencarian instan di memori (`< 50 ms`) meliputi:

- Nama kereta dan nomor KA.
- Nama stasiun, kode stasiun 3 huruf, kota/kabupaten, dan provinsi.

Memilih hasil pencarian langsung memusatkan peta ke posisi kereta atau lokasi stasiun (tetap di dalam batas Pulau Jawa) dan membuka panel detailnya.

### 7.2 Filter

Filter multi-pilihan sekaligus:

- **Kategori:** Antarkota, Commuter, Lokal, Bandara.
- **Status:** Berjalan (`running`), Berhenti (`stopping`), Persiapan (`boarding`), Terjadwal (`scheduled`), Tiba (`arrived`).
- Tersedia tombol cepat `Reset Filter` dan tampilan kosong informatif apabila kombinasi filter tidak menghasilkan perjalanan.

---

## 8. USER INTERFACE & EXPERIENCE

### 8.1 Arsitektur Tata Letak

Aplikasi menerapkan tata letak berorientasi peta (*map-first*) dalam tiga breakpoint terencana:

- **Desktop (`>= 1100px`):** Peta penuh di tengah; Header ringkas di atas; Panel Explorer kiri (`340px`) untuk daftar & filter; Panel Detail kanan (`360px`) saat kereta/stasiun dipilih; Kontrol Time Machine mengambang di bawah.
- **Tablet (`700px - 1099px`):** Panel tunggal terpadu dengan kontrol zoom dan Time Machine tersusun rapi tanpa menumpuk.
- **Ponsel (`< 700px`):** Peta mendominasi layar; Header kompak + tombol pencarian dan tema; Kontrol bottom bar dengan target sentuh minimal `44 x 44 px`; Explorer dan Detail terbuka sebagai *collapsible bottom sheet* tanpa overflow horizontal.

### 8.2 Keadaan UI dan Aksesibilitas

- Menyediakan **Empty State**, **Loading State**, dan **Error State** (dengan tombol muat ulang) yang jelas.
- Seluruh kontrol memakai elemen HTML semantik (`<button>`, `<input>`, `<label>`), dapat dinavigasi dengan keyboard (`Tab`, `Enter`, `Space`, `Escape`), dan memiliki indikator fokus kontras tinggi.
- Mematuhi `prefers-reduced-motion: reduce` dan memenuhi rasio kontras WCAG AA di mode Terang maupun mode Gelap.

---

## 9. DATA REQUIREMENTS, PIPELINE & VALIDASI

### 9.1 Sumber Data dan Atribusi

1. **Geometri Rel dan Stasiun:** Data OpenStreetMap Pulau Jawa melalui ekstrak Geofabrik (`java-latest-free.shp.zip`, layer `gis_osm_railways_free_1` dan `gis_osm_transport_free_1`), lisensi **ODbL** (`© OpenStreetMap contributors`).
2. **Batas Administratif Pulau Jawa:** GeoJSON provinsi Indonesia (`indonesia-province-simple.json`, sumber dasar BAKOSURTANAL) difilter ke 6 provinsi Pulau Jawa, serta garis pantai daratan Jawa dari Natural Earth 10m untuk masking wilayah luar Jawa.
3. **Referensi Jadwal:** Basis pola jadwal nasional GAPEKA 2025/2026 Pulau Jawa (Antarkota, Commuter Line regional, KA Lokal, dan KA Bandara via `oktavianrizalm/TrackingKRL`) serta jadwal KRL Commuter Line Jabodetabek (via Comuline API).

### 9.2 Pipeline Offline dan Validasi Otomatis

Pipeline Python (`scripts/build_java_data.py`) memproses data sebelum deploy:

1. Mengambil segmen rel aktif Jawa dan membangun graf topologi terhubung (`Comp 0`, merentang Merak hingga Ketapang).
2. Memetakan stasiun operasional dengan pencocokan nama dan jarak geografis (`< 1,5 km`), lalu mengaitkannya ke simpul graf rel terdekat (`< 1,2 km`).
3. Menghitung lintasan rel terpendek antar segmen stasiun (termasuk *via waypoints* untuk mengunci koridor Utara/Selatan/Bandung) dan menyimpan `cumDistKm`.
4. Memvalidasi seluruh jadwal: kelengkapan stasiun, urutan waktu naik, keberadaan jalur graf terhubung, serta kewajaran kecepatan segmen (`18 - 135 km/j`).
5. Data yang gagal validasi dicatat dan ditandai `Unknown` agar tidak pernah menghasilkan animasi kereta melompat atau keluar rel.

---

## 10. PERFORMANCE & ERROR HANDLING

- Animasi marker berjalan via `requestAnimationFrame` langsung ke sumber GeoJSON MapLibre tanpa memicu render ulang pohon komponen React pada setiap frame.
- Sinkronisasi UI panel detail dan jam berjalan terpisah pada interval ringan.
- Apabila gaya peta dasar eksternal gagal dimuat, aplikasi beralih otomatis ke gaya peta vektor/kartografi lokal Pulau Jawa menggunakan data provinsi dan jaringan rel yang sudah dibundel sehingga aplikasi tetap dapat digunakan.
- Apabila file data gagal dimuat, tampilkan pesan error yang menjelaskan penyebab dan tombol **Muat Ulang Data**.

---

## 11. OUT OF SCOPE (VERSI 1.0)

- Pelacakan GPS aktual atau integrasi sistem persinyalan internal PT KAI.
- Prediksi keterlambatan berbasis machine learning.
- Informasi ketersediaan kursi, tarif dinamis, atau pemesanan tiket.
- Pelacakan kereta barang dan jalur non-KAI (Whoosh, MRT, LRT) sebagai jadwal aktif.
- Visualisasi wilayah di luar Pulau Jawa.

---

## 12. ROADMAP & DEFINISI MVP

- **Fase 1 (Pondasi Geografis):** Penguncian batas peta Jawa, masker luar Jawa, batas 6 provinsi, jaringan rel terhubung Merak-Ketapang, serta database stasiun Jawa.
- **Fase 2 (Basis Jadwal & Rute):** Kompilasi jadwal referensi Antarkota, Commuter, Lokal, dan Bandara lintas 6 provinsi beserta pra-komputasi poliline rute rel dan validasi ketat.
- **Fase 3 (Simulation Engine):** Mesin interpolasi berbasis jarak kumulatif, kurva akselerasi/deselerasi, state machine status kereta, penanganan lintas tengah malam, dan unit test otomatis.
- **Fase 4 (Peta Animasi & Antarmuka):** Peta WebGL MapLibre dengan rotasi marker, visualisasi rute terpilih, pencarian instan, filter multi-kriteria, detail kereta/stasiun, serta dukungan tema Terang & Gelap.
- **Fase 5 (Time Machine & Verifikasi Responsif):** Slider timeline 24 jam, percepatan 0.5x-20x, mode hari operasional, serta pengujian menyeluruh desktop, tablet, ponsel, dan aksesibilitas keyboard.

---

## 13. SUCCESS METRICS

- 100% stasiun pada jadwal referensi berhasil dipetakan di atas jaringan rel Jawa yang terhubung.
- 100% perjalanan tervalidasi memiliki rute kontinu mengikuti rel tanpa garis lurus memotong daratan.
- Kamera peta tidak dapat digeser atau diperkecil keluar dari batas Pulau Jawa.
- Animasi berjalan stabil tanpa error konsol dan respons pencarian berlangsung instan di bawah 100 ms.
- Seluruh fitur interaktif berjalan lengkap pada desktop, tablet, dan ponsel dalam mode Terang maupun Gelap.

---

## 14. FINAL PRODUCT VISION

KAIStream hadir sebagai atlas pemantauan perkeretaapian Pulau Jawa yang akurat secara geometris, jujur dalam membedakan jadwal simulasi dari GPS aktual, dan nyaman dijelajahi oleh siapa saja. Pengguna dapat membuka peta Pulau Jawa, menelusuri jaringan rel dari ujung barat Merak hingga ujung timur Ketapang, menyaksikan kereta bergerak selaras di atas lintasan rel yang sesungguhnya, memeriksa jadwal setiap stasiun, serta memutar ulang denyut perjalanan kereta sepanjang hari melalui Time Machine.
