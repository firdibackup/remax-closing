> **Update API bot untuk Hermes: polling 1 menit + `POST /api/bot/reminder-skip`**
>
> **Jadwal baru:** panggil `GET /api/bot/reminders/due` **tiap 1 menit, 24 jam** (bukan 5 menit, tidak ada lagi batas 08.00–17.00 WIB).
> Kantor yang sudah diberikan dikunci **2 menit** (bukan 10 menit). Laporkan `reminder-log` / `reminder-skip` dalam 2 menit;
> kalau lewat, kantor itu diberikan lagi (paling banyak 3 kali) dan bisa terkirim dobel.
>
> **reminder-skip:** pakai kalau kantor dari `/reminders/due` sudah diambil tapi **tidak perlu dikirimi WA**, misalnya semua closing-nya
> sudah `reported`. Jangan kirim WA, dan jangan panggil `reminder-log`.
>
> ```json
> {"cabang_id":"uuid","period":"2026-10","request_id":"uuid","reason":"no_outstanding_closings","note":"12 closing sudah reported"}
> ```
> - `request_id` wajib, ambil dari `/reminders/due`.
> - `reason` pilih salah satu:
>   - `no_outstanding_closings`: ada closing di Genius, semuanya sudah reported.
>   - `no_closings`: kantor itu tidak punya closing di Genius untuk periode ini.
>   - `other`: alasan lain, jelaskan di `note`.
> - `note` boleh dikosongkan, maksimal 200 karakter, dan tampil di Beranda.
> - Respons `{"status":"ok","duplicate":false}`. Kalau permintaan sudah ditutup sebelumnya: `duplicate:true` dengan
>   `closed: sent|skipped|cancelled`. Ini bukan error, lanjut saja.
> - Aturan: **setiap kantor dari `/reminders/due` harus ditutup dalam 2 menit**, dengan `reminder-log` kalau WA terkirim
>   atau `reminder-skip` kalau tidak. Kalau tidak ditutup, kantor itu diberikan ulang sampai 3 kali.
>
> Detail lengkap: bagian 4a di bawah.

# API Bot WhatsApp (Hermes ↔ Web Rekap Closing)

Web adalah sumber jadwal, kontak kantor, dan validasi. Hermes mengirim dan membaca WhatsApp, menarik daftar closing dari Genius,
lalu mengirim hasil akhir balasan admin ke web.

- **Base URL (uji lokal):** `https://crummiest-dangle-theme.ngrok-free.dev/api/bot/`
- **Header wajib:** `Authorization: Bearer <BOT_API_KEY>` dan `ngrok-skip-browser-warning: 1`
- Tanpa kunci yang benar → `401 {"status":"error","message":"Kunci bot tidak valid."}`
- Semua waktu ISO 8601. `period` selalu `YYYY-MM`. Nomor WA format `+62…`.

## Alur

Hermes memanggil `GET /reminders/due` **tiap 1 menit, 24 jam**. Web yang menentukan siapa yang dikirimi:
reminder terjadwal (tanggal/jam di halaman *Periode & Cut-off*) dan permintaan HQ dari Beranda (*Ingatkan* / *File tidak ada*).
Jangan memasang jadwal atau batas "sudah dikirim hari ini" sendiri di Hermes. Web sudah menjaganya.

1. `GET /reminders/due`. Kalau `offices` kosong, selesai (lihat `reason`).
2. Tarik Genius `GET /closings?filterClosingDateStartAt=…&filterClosingDateEndAt=…` memakai `genius_filter` dari langkah 1,
   dengan `includeData` supaya `listingPerson`, `sellingPerson`, `coListingPersons`, `coSellingPersons` ikut. Baca semua halaman.
3. Kelompokkan closing per `office_code`: cocokkan `.office.officeCode` di **semua pihak**, bukan hanya awalan Closing ID.
   Satu `office_code` bisa dipakai beberapa cabang: kirim daftar yang sama ke tiap cabang.
4. `POST /closings/status` untuk membuang closing yang statusnya `reported`.
5. Kirim WA ke `send_to`, lalu `POST /reminder-log` dengan `request_id` dari langkah 1.
   Kalau ternyata tidak ada yang perlu dikirim (mis. semua closing kantor itu sudah `reported`), **jangan kirim WA**:
   panggil `POST /reminder-skip` dengan `request_id` itu (bagian 4a). Setiap kantor dari `/reminders/due` harus ditutup
   dengan salah satu dari dua panggilan ini.
   - `mode: "genius"`: daftar Closing ID bernomor, minta balas nomor yang sudah fix, `semua`, atau `nihil`.
   - `mode: "excel"`: minta upload file laporan ke `drive_url`, lalu balas "sudah". Tidak perlu tarik Genius.
   - Isi pesan menyesuaikan `trigger` (lihat bagian 1).
6. Saat admin membalas, `POST /closing-confirmations`, lalu teruskan `message` dari respons ke admin.

Closing yang belum dikonfirmasi tetap muncul lagi di tanggal kirim berikutnya selama periodenya terbuka.

## 1. `GET /reminders/due`

Kantor yang perlu dikirimi WA **sekarang**. Bot harus aktif di web dan ada periode terbuka. Isinya:
- reminder terjadwal, kalau tanggal dan jam WIB cocok dengan jadwal di web;
- permintaan HQ dari Beranda, kapan saja (tidak ada batas jam).

Setiap kantor yang dikembalikan langsung dicatat **sedang diambil** selama 2 menit, jadi panggilan 1 menit berikutnya
tidak mengembalikannya lagi. Kalau Hermes tidak melapor (`POST /reminder-log` atau `POST /reminder-skip`) dalam 2 menit, kantor itu
diberikan lagi, paling banyak 3 kali.

`?preview=1` mengabaikan jadwal dan jam, dan **tidak** mengambil antrean (aman dipanggil berulang, hanya untuk uji).

```json
{
  "date": "2026-11-01", "preview": false, "active": true, "send_days": [25, 1, 3], "send_hour": 9,
  "period": "2026-10", "cutoff_at": "2026-11-03T16:59:00.000Z",
  "genius_filter": { "filterClosingDateStartAt": "2026-10-01", "filterClosingDateEndAt": "2026-10-31" },
  "offices": [
    { "cabang_id": "uuid", "office_code": "F21002", "cabang_name": "…", "induk_name": "…", "mode": "genius",
      "send_to": "+62812…", "contact_jenis": "admin", "has_lines": false, "trigger": "schedule", "request_id": "uuid" },
    { "cabang_id": "uuid", "office_code": "F31005", "cabang_name": "…", "induk_name": "…", "mode": "excel",
      "send_to": "+62813…", "contact_jenis": "bo", "has_lines": false, "trigger": "drive_missing", "request_id": "uuid",
      "drive_url": "https://drive.google.com/…", "uploaded_reply_at": "2026-11-14T03:10:00.000Z" }
  ],
  "skipped": [ { "cabang_id": "uuid", "cabang_name": "…", "reason": "tidak ada nomor WA kontak" } ]
}
```

- **Periode tujuan:** periode yang sudah mulai dan masih terbuka dengan cut-off terdekat. Dikendalikan dari dashboard: kalau HQ
  membuka kunci September, fokus pindah ke September.
- **`trigger`** menentukan isi pesan:
  - `schedule`: reminder terjadwal biasa.
  - `manual`: HQ klik *Ingatkan* di Beranda. Isinya sama dengan reminder biasa (Genius: daftar Closing ID; Excel: link Drive).
  - `drive_missing`: kantor Excel sudah membalas "sudah", tapi HQ mengecek Drive dan filenya tidak ada atau salah.
    Contoh pesan: *"Halo, kami cek di Google Drive, file closing {periode} {cabang_name} belum ada/belum sesuai.
    Mohon diunggah ulang di: {drive_url}. Balas 'sudah' setelah diunggah."*
- **`request_id`**: kirim balik di `POST /reminder-log`. `null` hanya di `?preview=1`.
- **Tidak ikut** (masuk `skipped`): kantor yang sudah ditandai Nihil, kantor Excel yang filenya sudah diunggah HQ,
  kantor Excel yang sudah membalas "sudah upload ke Drive" (menunggu HQ cek), kantor yang sudah dikirimi reminder terjadwal
  hari itu, kantor yang sedang dikirim bot, dan kantor tanpa nomor WA.
- **`send_to`:** kontak utama → Admin → BO. Satu nomor per cabang.
- Kirim `cabang_id` dan `period` apa adanya ke endpoint lain.

## 2. `GET /offices`

Semua kantor aktif dan nomor WA-nya (untuk sinkron atau cek nomor pengirim):
`{ "offices": [ { "cabang_id", "office_code", "cabang_name", "induk_name", "report_channel", "mode", "send_to", "contact_jenis", "wa_admin", "wa_bo" } ] }`

## 3. `POST /closings/status`

```json
{ "closing_codes": ["C26F31001/0201", "C26F31001/0202"] }
```
atau, supaya web tidak perlu memanggil Genius lagi (lebih cepat):
```json
{ "closings": [ { "closing_code": "C26F31001/0201", "invoice_numbers": ["I26F31001/0190"] } ] }
```
Respons:
```json
{ "results": [
  { "closing_code": "C26F31001/0201", "status": "reported", "invoices": ["I26F31001/0190"], "pending_invoices": [] },
  { "closing_code": "C26F31001/0202", "status": "partial", "invoices": ["…", "…"], "pending_invoices": ["…"] },
  { "closing_code": "C26F31001/0203", "status": "unknown", "error": "tidak ditemukan di Genius" }
] }
```
`status` bisa bernilai `reported`, `partial`, `not_reported`, atau `unknown`. Maksimal 300 Closing ID per request.
Kirim ke admin yang `not_reported` dan `partial`.

## 4. `POST /reminder-log`

```json
{ "cabang_id": "uuid", "period": "2026-10", "mode": "genius", "sent_at": "2026-10-25T09:00:00+07:00",
  "sent_to": "+62812…", "closing_codes": ["C26F31001/0201"], "message_id": "wamid.xxx", "request_id": "uuid" }
```
`request_id` dari `/reminders/due` menutup antrean kantor itu, jadi kantor tidak diberikan lagi.
Respons: `{ "status": "ok", "duplicate": false }`. `message_id` yang sama tidak dicatat dua kali (`duplicate: true`).
Web menampilkan "WA reminder 25 Okt 09:00" di halaman Rekonsiliasi.

## 4a. `POST /reminder-skip`

Kantor sudah diambil dari `/reminders/due`, tetapi WA **tidak dikirim** karena tidak ada yang perlu ditagih.

```json
{ "cabang_id": "uuid", "period": "2026-10", "request_id": "uuid", "reason": "no_outstanding_closings",
  "note": "12 closing sudah reported" }
```
- `request_id` wajib (dari `/reminders/due`). Permintaan itu ditutup, jadi kantor tidak diberikan ulang untuk permintaan itu.
- `reason`:
  - `no_outstanding_closings`: ada closing di Genius, semuanya sudah `reported`.
  - `no_closings`: tidak ada closing kantor itu di Genius untuk periode ini.
  - `other`: alasan lain, jelaskan di `note`.
- `note` opsional, maks 200 karakter, tampil di Beranda.

Respons: `{ "status": "ok", "duplicate": false }`. Permintaan yang sudah ditutup (terkirim, dilewati, atau dibatalkan HQ)
tidak diubah: `{ "status": "ok", "duplicate": true, "closed": "sent" | "skipped" | "cancelled" }`.
`400` kalau field salah, `404` kalau `request_id` bukan milik kantor dan periode itu.

Tidak dicatat sebagai "WA reminder terkirim" di Rekonsiliasi. Kartu kantor di Beranda menampilkan
"Dicek bot 14 Nov 10.05: tidak ada closing outstanding", dan HQ bisa klik *Ingatkan* lagi kapan saja.
Reminder terjadwal hari itu juga ikut tertutup; kantor muncul lagi di tanggal kirim berikutnya.

## 5. `POST /closing-confirmations`

```json
{ "cabang_id": "uuid", "period": "2026-10", "reply_from": "+62812…",
  "kind": "closings", "confirmed_closing_codes": ["C26F31001/0201"],
  "raw_reply": "1,2", "message_id": "wamid.yyy", "replied_at": "2026-10-25T10:15:00+07:00" }
```
`kind` bisa bernilai:
- `closings`: Closing ID yang dikonfirmasi admin. Web memprosesnya seperti halaman Input: invoice yang sudah dilaporkan
  dilewati, dan closing dengan agen/kantor yang belum ada di master ditahan.
- `nihil`: tidak ada closing bulan ini. `confirmed_closing_codes` boleh kosong.
- `excel_uploaded`: admin bilang sudah upload ke Drive. Kartu kantor di Beranda jadi **Cek Drive** dan bot berhenti
  mengingatkan kantor itu. HQ mengunduh file dari Drive lalu mengimpornya lewat halaman Upload (status jadi *Sudah lapor*).
  Kalau filenya tidak ada, HQ klik *File tidak ada* dan kantor muncul lagi di `/reminders/due` dengan `trigger: "drive_missing"`.
  Kirim setiap kali admin membalas "sudah", termasuk setelah pesan `drive_missing`.

Respons (teruskan `message` ke admin di WA):
```json
{ "status": "partial", "saved": ["C26F31001/0201"], "already_reported": [],
  "held": [ { "closing_code": "C26F31001/0202", "reason": "agen A24277 belum di master" } ],
  "errors": [], "lines": 2, "message": "1 closing tersimpan, 1 ditahan (data agen/kantor belum lengkap, HQ akan melengkapi).",
  "confirmation_id": "uuid", "duplicate": false }
```
- **`status`:**
  - `saved`: semua beres.
  - `partial`: sebagian tersimpan.
  - `held`: semua ditahan karena master belum lengkap.
  - `rejected`: tidak diproses.
  - `noted`: `excel_uploaded` dicatat.
- **`rejected`** terjadi kalau periode sudah lewat cut-off, nomor pengirim bukan kontak kantor itu, Closing ID bukan milik
  kantor itu, atau Nihil padahal kantor sudah punya closing.
- **`message_id` yang sama** mengembalikan hasil pertama (`duplicate: true`) tanpa diproses ulang.
  Kalau masih diproses, respons `409` dan Hermes boleh mencoba lagi sebentar kemudian.
- **Error server (5xx):** aman diulang dengan `message_id` yang sama.

## Uji

- Pakai `?preview=1` di `/reminders/due`. Antrean tidak diambil dan jadwal diabaikan.
- Pakai `message_id` berawalan `test-` untuk log dan balasan uji, supaya mudah dihapus.
