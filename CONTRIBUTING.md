# Panduan Kontribusi

Terima kasih atas minat Anda untuk berkontribusi pada KAIStream. Dokumen ini merangkum alur kerja pengembangan lokal, aturan integritas dataset, serta pemeriksaan kualitas yang wajib lulus sebelum mengajukan perubahan.

## Alur Kerja Pengembangan

1. Pastikan Node.js `22+` sudah terpasang (serta Python `3.11+`, `networkx`, `beautifulsoup4`, dan `poppler-utils` jika perubahan Anda menyentuh skrip data di `scripts/`).
2. Pasang dependensi dengan `npm install`.
3. Buat cabang kerja baru untuk fitur atau perbaikan bug yang Anda kerjakan.
4. Jalankan server pengembangan melalui `npm run dev` untuk memeriksa perubahan secara interaktif.

## Standar Integritas Dataset dan Simulasi

Apabila Anda memperbarui [`scripts/build_java_data.py`](scripts/build_java_data.py), [`scripts/djka_source.py`](scripts/djka_source.py), atau berkas di [`public/data/`](public/data/), pastikan aturan berikut terpenuhi:

1. Cakupan geografis stasiun dan polilin rute wajib berada di dalam batas ketat Pulau Jawa (`JAVA_STRICT_BOUNDS`: bujur `104.90` s.d. `114.75`, lintang `-8.98` s.d. `-5.68`).
2. Graf jaringan PT KAI (`1067 mm`) dan graf Kereta Cepat Whoosh (`1435 mm`) wajib tetap terpisah secara fisik. Jangan menghubungkan stasiun `HLM`, `KRW`, atau `TGLR` ke graf `D_kajj`/`D_krl`, serta pastikan `whoosh_g1003` (arah Tegalluar) dan `whoosh_g1004` (arah Halim) tidak berbagi titik koordinat rute yang sama.
3. Jangan gunakan kode stasiun `TGL` untuk Tegalluar Summarecon karena `TGL` adalah kode resmi Stasiun Tanggul (Jember). Gunakan `TGLR` untuk Tegalluar Summarecon dan `KRW` untuk Stasiun Karawang Whoosh (terpisah dari `KW` Stasiun Karawang KAI).
4. Setelah membangun ulang data dengan `npm run build:data`, nilai `metadata.counts.validationErrors` pada `public/data/metadata.json` wajib bernilai `0`.

## Standar Antarmuka dan Dokumentasi

1. Ikuti token warna, tipografi (`Source Serif 4`, `IBM Plex Sans`, `IBM Plex Mono`), dan kontras WCAG AA yang terdokumentasi di [`DESIGN.md`](DESIGN.md).
2. Pertahankan tampilan kontrol mengambang di halaman peta tetap bersih tanpa border berat, serta pastikan seluruh tombol interaktif pada tampilan mobile (`<= 699px`) memiliki tinggi dan lebar ketuk minimal `44x44 piksel` tanpa menimbulkan scroll horizontal.
3. Hindari penggunaan karakter em dash (tanda hubung panjang), judul dengan dekorasi emoji, maupun klaim tanpa sumber data nyata pada seluruh teks antarmuka, komentar kode, dan dokumentasi Markdown.

## Daftar Periksa Sebelum Mengajukan Pull Request

Jalankan perintah berikut dari direktori akar repositori dan pastikan seluruhnya selesai dengan kode keluar `0`:

```bash
# 1. Pastikan seluruh 13 rangkaian tes unit dan integrasi dataset lulus
npm test

# 2. Pastikan pemeriksaan tipe TypeScript dan bundel produksi Vite berhasil
npm run build
```
