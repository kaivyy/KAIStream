# Mesin Simulasi, Interpolasi `Ls`, dan Geometri Kereta

Dokumen ini menjelaskan cara KAIStream menghitung posisi dan status setiap kereta secara deterministik pada waktu simulasi $t \in [0, 86399]$ detik WIB (`UTC+7`) di dalam [`src/engine/simulation.ts`](../src/engine/simulation.ts) dan [`src/engine/geometry.ts`](../src/engine/geometry.ts).

## Siklus Status Perjalanan (`TrainStatus`)

Untuk setiap perjalanan (`TrainTrip`) dengan waktu keberangkatan awal `startSec` dan waktu tiba akhir `endSec`, fungsi `evaluateTripAtShiftedTime` menentukan salah satu dari tujuh status berikut:

| Status | Label UI | Kondisi Waktu Evaluasi ($t$) | Posisi di Peta |
| :--- | :--- | :--- | :--- |
| `scheduled` | `Terjadwal` | $t < \text{startSec} - 900\text{ dtk}$ (lebih dari 15 menit sebelum berangkat) | `null` (belum ditampilkan di rel) |
| `boarding` | `Persiapan` | $\text{startSec} - 900\text{ dtk} \le t < \text{startSec}$ | Koordinat stasiun asal (`distKm = 0`), kecepatan `0 km/j` |
| `running` | `Berjalan` | $\text{depSec}_i \le t < \text{arrSec}_{i+1}$ di antara dua stasiun pemberhentian | Diinterpolasi sepanjang polilin rute |
| `stopping` | `Berhenti` | $\text{arrSec}_i \le t < \text{depSec}_i$ pada stasiun pemberhentian antara | Koordinat stasiun $i$, kecepatan `0 km/j` |
| `arrived` | `Tiba` | $\text{endSec} \le t \le \text{endSec} + 600\text{ dtk}$ (hingga 10 menit setelah tiba) | Koordinat stasiun tujuan akhir (`distKm = totalDistKm`) |
| `completed` | `Selesai` | $t > \text{endSec} + 600\text{ dtk}$ | `null` (selesai berdinas) |
| `unknown` | `Unknown` | Perjalanan gagal melewati `validateDataset` | `null` |

## Penanganan Kereta Lintas Tengah Malam (`Overnight Spillover`)

Banyak KA Antarkota dan KRL malam berangkat sebelum pukul `24:00 WIB` dan baru tiba di tujuan pada dini hari berikutnya (dalam format waktu layanan hingga `48:00:00` atau `172.800` detik).

Fungsi `evaluateTrainAtTime` memeriksa dua jendela evaluasi sekaligus:

1. Hari berjalan (`activeDayShift = 0`): kereta dievaluasi pada detik $t = \text{simSeconds}$ apabila jadwal hari ini cocok dengan filter `dayMode` (`all`, `weekday`, atau `weekend`).
2. Limpahan hari sebelumnya (`activeDayShift = 86400`): apabila `trip.endSec + 600 > 86400`, kereta juga dievaluasi pada detik $t = \text{simSeconds} + 86400$. Jika pada jam dini hari tersebut kereta masih berstatus `running`, `stopping`, atau `arrived`, posisi limpahan semalam yang ditampilkan.

## Interpolasi Piecewise dengan Titik Lintas (`Ls`)

Kereta ekspres dan Kereta Cepat Whoosh sering melewati sejumlah stasiun tanpa berhenti (`Ls` / Langsung). Jika posisi hanya diinterpolasi secara linier di antara dua stasiun pemberhentian yang berjarak puluhan kilometer, kereta dapat tampak mendahului atau tertinggal dari jadwal lintas sebenarnya di stasiun antara.

Fungsi `interpolatePiecewiseLeg` mengatasi hal ini dengan menyusun simpul waktu-jarak (`knots`):

$$(t_0, d_0), (t_{\text{Ls},1}, d_{\text{Ls},1}), \dots, (t_{\text{Ls},k}, d_{\text{Ls},k}), (t_1, d_1)$$

- Apabila sebuah petak tidak memiliki titik `Ls`, fungsi memakai kurva `applyKinematicEasing` (kombinasi kemudahan kuadratik pada fase akselerasi awal serta pengereman akhir, dan kecepatan jelajah konstan di tengah petak).
- Apabila petak memiliki satu atau lebih titik `Ls` (seperti `31` perjalanan Whoosh yang melintas langsung di Stasiun Karawang `KRW`), petak dibagi menjadi sub-segmen di antara simpul-simpul tersebut:
  - Sub-segmen pertama ($k = 0$) menerapkan kurva akselerasi keluar dari stasiun keberangkatan.
  - Sub-segmen tengah ($0 < k < \text{last}$) mempertahankan kecepatan linier saat kereta melaju penuh melewati stasiun `Ls`.
  - Sub-segmen terakhir ($k = \text{last}$) menerapkan kurva pengereman halus menjelang stasiun pemberhentian berikutnya.

## Artikulasi 4 Kereta Mengikuti Lengkung Rel

KAIStream tidak merender kereta sebagai satu titik ikon statis atau garis ekor panjang, melainkan sebagai **4 unit terartikulasi** (`1` lokomotif/kabin depan + `3` kereta di belakangnya) yang dihitung oleh `computeArticulatedConsist` di [`src/engine/geometry.ts`](../src/engine/geometry.ts):

1. Tata letak jarak pusat dan jarak bogie setiap unit ditentukan dalam satuan piksel layar (`ARTICULATED_CAR_LAYOUT`), lalu dikonversi ke kilometer sepanjang polilin rute sesuai skala zoom saat ini (`kmPerCssPx * iconScale`).
2. Untuk masing-masing dari 4 unit kereta, posisi bogie depan (`carDistKm + halfKm`) dan bogie belakang (`carDistKm - halfKm`) diproyeksikan langsung ke polilin rel menggunakan `interpolatePolylineExtrapolated`.
3. Titik tengah unit kereta adalah rata-rata koordinat bogie depan dan belakang, sedangkan sudut hadap (`bearingDeg`) masing-masing unit dihitung dari vektor arah bogie belakang menuju bogie depan (`computeBearingDeg`).
4. Ketika rangkaian melewati tikungan tajam (seperti petak Padalarang s.d. Purwakarta atau lengkung Tegalluar), setiap unit memutar mengikuti garis singgung lokal rel pada posisinya masing-masing dan dihubungkan oleh polilin sambungan (`couplerCoords`).

## Pemisahan Lajur Visual Anti-Tabrakan

Selain pemisahan graf fisik (`D_kajj`/`D_krl` sepur kanan dan `G_whoosh_eb`/`G_whoosh_wb` yang terpisah sekitar `5 meter`), pada tingkat zoom menengah-jauh (`zoom < 17.5`) jarak fisik `5 meter` di dunia nyata berukuran lebih kecil daripada lebar piksel ikon kereta di layar.

Di dalam [`src/components/JavaRailMap.tsx`](../src/components/JavaRailMap.tsx), rangkaian Kereta Cepat Whoosh diberikan pergeseran lateral adaptif ke sisi kanan arah perjalanan (`applyLateralOffset`):

$$\text{extraRightM} = \max\left(0,\; 5.5 \times \text{iconScale} - \frac{2.5}{\text{mPerCssPx}}\right) \times \text{mPerCssPx}$$

- Pada zoom jauh dan menengah (`z7` s.d. `z15.5`), rumus ini menjaga celah visual bersih antar-rangkaian yang berpapasan sehingga dua kereta Whoosh dari arah berlawanan tidak pernah saling menumpuk.
- Saat peta diperbesar hingga `z17.5` ke atas (ketika jarak fisik `5 meter` sudah melampaui lebar sprite kereta), `extraRightM` menyusut halus menjadi `0 meter` sehingga keempat kereta berada tepat di atas as rel ganda `1435 mm` masing-masing.
