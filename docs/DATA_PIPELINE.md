# Pipeline Data dan Konstruksi Graf Rel

Seluruh berkas JSON di [`public/data/`](../public/data/) dihasilkan oleh skrip [`scripts/build_java_data.py`](../scripts/build_java_data.py) bersama modul [`scripts/djka_source.py`](../scripts/djka_source.py). Pipeline ini dirancang dengan arsitektur berlapis (`multi-tier failover`) sehingga pembaruan data maupun pembuatan ulang secara offline tetap menghasilkan dataset yang utuh meskipun salah satu situs hulu sedang tidak dapat diakses.

## Hierarki Sumber Data dan Failover

| Kategori Layanan | Penyedia Primer | Penyedia Failover / Pengayaan |
| :--- | :--- | :--- |
| Geometri Rel & Batas Wilayah | Ekstrak Shapefile Geofabrik OSM Pulau Jawa (`gis_osm_railways_free_1.shp`) + BAKOSURTANAL + Natural Earth | Cache lokal di `.cache/` |
| KA Antarkota, Lokal & Bandara (`1067 mm`) | AluRail Public Data (`stations`, `schedules`, dan ekstraksi titik waktu `Ls` per halaman jadwal) | Dokumen resmi Kemenhub DJKA `KP-DJKA 116 Tahun 2026` (GAPEKA Jawa) + `TrackingKRL` (`national-gapeka.json`) |
| KRL Commuter Line Jabodetabek (`1067 mm`) | Comuline API + rekonsiliasi perjalanan malam & pola hari kerja dari Sobat KRL GTFS (ODbL 1.0) | Mode mandiri (`standalone`) Sobat KRL Master Data GTFS |
| Kereta Cepat Whoosh (`1435 mm`) | Dokumen PDF resmi Kemenhub DJKA `KP-DJKA 2 Tahun 2025` (halaman 14 s.d. 24, Skenario Reguler 62 KA) via `pdftotext` | Cache PDF lokal `.cache/djka/kp_djka_2_2025_whoosh.pdf` dan fallback jadwal Whoosh pada `national-gapeka.json` |

## Pemisahan Fisik Graf `1067 mm` (PT KAI) dan `1435 mm` (Whoosh KCIC)

Pulau Jawa memiliki dua sistem jalan rel dengan lebar sepur berbeda yang tidak saling terhubung secara fisik: jaringan konvensional PT KAI (`1067 mm`) dan jaringan Kereta Cepat Jakarta-Bandung Whoosh (`1435 mm`). Agar rute kereta tidak pernah melompat antar-jaringan atau bertabrakan di jalur berlawanan, `build_java_data.py` membangun graf terarah yang terpisah sama sekali:

### 1. Graf Terarah `1067 mm` (`D_kajj` dan `D_krl`)

1. Saat membaca `gis_osm_railways_free_1.shp`, seluruh segmen yang memiliki `fclass == "rail"` tetapi bernama `"cepat"` disisihkan dari graf `1067 mm` (`G_undir`).
2. Komponen terhubung terbesar (`comp0_nodes`, `56.886` node dengan presisi koordinat `0.11 m`) dipilih sebagai jaringan operasional utama PT KAI di Pulau Jawa.
3. Fungsi `lateral_profile` memindai segmen-segmen rel yang sejajar dalam radius `24 m` secara tegak lurus untuk menghitung jumlah jalur paralel (`1`, `2`, `3`, atau `4+` jalur) dan urutan lajur dari kiri ke kanan (`rank`).
4. Bobot sisi terarah (`edge_mult`) memberikan penalti pada jalur kiri sehingga algoritma lintasan terpendek (`nx.shortest_path`) secara otomatis memilih **sepur kanan** pada koridor jalur ganda.
5. Pada koridor Double-Double Track (DDT) Manggarai s.d. Bekasi (`4` jalur sejajar), `D_kajj` mengarahkan KA Antarkota ke sepasang jalur utama, sedangkan `D_krl` mengarahkan KRL Commuter Line ke sepasang jalur komuter sehingga KRL dan KAJJ berjalan pada lajur yang terpisah.
6. Setiap stasiun `1067 mm` diproyeksikan tegak lurus ke seluruh segmen rel operasional dalam jarak `<= 65 m` melalui simpul virtual `("OUT", code)` dan `("IN", code)`.

### 2. Graf Jalur Ganda Terisolasi `1435 mm` (`G_whoosh_eb` dan `G_whoosh_wb`)

1. Segmen-segmen OSM bertanda `"cepat"` (`316` segmen, mencakup `130` jembatan layang dan `26` terowongan) dikumpulkan ke dalam graf `G_whoosh_raw`.
2. Di dalam data OSM Pulau Jawa, koridor Halim s.d. Tegalluar terdiri atas tepat dua komponen terhubung utuh yang sejajar dengan jarak antar-as sekitar `5 meter`:
   - Komponen lajur selatan (`G_whoosh_eb`, `704` node): dipakai khusus untuk perjalanan arah timur (`Halim -> Tegalluar`, nomor KA ganjil `G1003` s.d. `G1063`, sepur kanan arah Bandung).
   - Komponen lajur utara (`G_whoosh_wb`, `686` node): dipakai khusus untuk perjalanan arah barat (`Tegalluar -> Halim`, nomor KA genap `G1004` s.d. `G1064`, sepur kanan arah Jakarta).
3. Stasiun `HLM` (Halim), `KRW` (Karawang Whoosh), dan `TGLR` (Tegalluar Summarecon) hanya dihubungkan ke `G_whoosh_eb` dan `G_whoosh_wb`, bukan ke `D_kajj` maupun `D_krl`.
4. Stasiun `PDL` (Padalarang) dipertahankan di `D_kajj`/`D_krl` untuk melayani KA Feeder Whoosh serta Commuter Line Bandung Raya (`1067 mm`), dan sekaligus dipetakan ke titik terdekat pada `G_whoosh_eb` serta `G_whoosh_wb` khusus ketika merutekan perjalanan kategori `highspeed`. Dengan demikian, polilin rute Whoosh dan KAI memiliki `0` titik koordinat yang beririsan, tetapi keduanya tetap terhubung sebagai satu hub transit di `PDL` pada fitur pencarian rute.

## Ekstraksi Jadwal Whoosh dari PDF `KP-DJKA 2 Tahun 2025`

Fungsi `build_djka_whoosh_trips` di [`scripts/djka_source.py`](../scripts/djka_source.py) mengekstrak jadwal resmi Whoosh secara langsung dari lampiran Buku Perjalanan Kereta Api (`KP-DJKA 2 Tahun 2025`, halaman 14 s.d. 24):

- Setiap tabel `WHOOSH: G10xx` diparse menggunakan `pdftotext -layout -f 14 -l 24`.
- Untuk `31` perjalanan yang berhenti di Stasiun Karawang (`KRW`), jam datang dan jam berangkat disimpan sebagai objek `TrainStop` penuh (berhenti `2 menit`).
- Untuk `31` perjalanan yang melintas langsung di Stasiun Karawang (ditandai `Ls` pada kolom Datang di PDF resmi), `KRW` tidak dimasukkan ke daftar pemberhentian penumpang, melainkan disimpan sebagai `legWaypoints` (`[("KRW", pass_sec)]`) yang kemudian dikonversi menjadi `passPoints` (`[detik, km]`) pada berkas `timetable.json`.

## Penggunaan CLI `build_java_data.py`

```bash
python3 scripts/build_java_data.py [OPSI]
```

| Flag CLI | Fungsi |
| :--- | :--- |
| `--snapshot YYYY_MM_DD` | Menentukan tag tanggal snapshot WIB (bawaan: tanggal hari ini di zona WIB) |
| `--refresh` | Memaksa pengunduhan ulang jadwal dari API/situs hulu dan memperbarui cache `.cache/` |
| `--auto` | Mode sinkronisasi harian otomatis dengan fallback ke cache/DJKA bila hulu gagal |
| `--prefer-djka` | Mengutamakan ekstraksi langsung regulasi resmi Kemenhub DJKA `KP-DJKA 116 Tahun 2026` |
| `--disable-alurail` | Menonaktifkan pemanggilan AluRail dan memicu failover ke GAPEKA DJKA + `TrackingKRL` |
| `--disable-comuline` | Menonaktifkan pemanggilan Comuline API dan memicu failover mandiri Sobat KRL GTFS |
| `--output-dir PATH` | Direktori tujuan penulisan JSON (bawaan: `public/data`) |
| `--mirror-dir PATH` | Direktori salinan tambahan setelah penulisan atomik selesai (misalnya `dist/data`) |

## Gerbang Keamanan Build (`Safety Gates`)

Sebelum menimpa berkas di `public/data/`, `build_java_data.py` menjalankan pemeriksaan ketat:

1. Validasi kecepatan per segmen menolak rute yang memiliki kecepatan rata-rata tidak masuk akal (`> 155 km/j` untuk rel `1067 mm`, `> 370 km/j` untuk rel `1435 mm`, atau `< 10 km/j` pada petak jarak jauh `> 12 km`).
2. Titik lintas `Ls` (`passPoints`) disaring agar selalu monoton terhadap waktu maupun jarak kumulatif.
3. Jumlah total perjalanan tervalidasi wajib melampaui ambang batas minimum (`>= 1.500` perjalanan pada mode normal atau `>= 1.000` pada mode failover) dan jumlah stasiun `>= 400`.
4. Kereta yang sudah dihapus dari GAPEKA aktif (seperti `Baturraden Ekspres`) dipastikan tidak bocor ke dalam output.
5. Penulisan berkas dilakukan secara atomik menggunakan berkas sementara (`.tmp`) sebelum dipindahkan ke nama berkas akhir (`stations.json`, `routes.json`, `timetable.json`, `rail-network.json`, `java-provinces.json`, `java-mask.json`, `metadata.json`).
