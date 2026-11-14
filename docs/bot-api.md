# API Bot WhatsApp (Hermes ↔ Web Rekap Closing)

Web adalah sumber jadwal, kontak kantor, dan validasi. Hermes mengirim dan membaca WhatsApp, menarik daftar closing dari Genius,
lalu mengirim hasil akhir balasan admin ke web.

- **Base URL (uji lokal):** `https://crummiest-dangle-theme.ngrok-free.dev/api/bot/`
- **Header wajib:** `Authorization: Bearer <BOT_API_KEY>` dan `ngrok-skip-browser-warning: 1`
- Tanpa kunci yang benar → `401 {"status":"error","message":"Kunci bot tidak valid."}`
- Semua waktu ISO 8601. `period` selalu `YYYY-MM`. Nomor WA format `+62…`.

## Alur harian

1. `GET /reminders/due`. Kalau `offices` kosong, selesai (lihat `reason`).
2. Tarik Genius `GET /closings?filterClosingDateStartAt=…&filterClosingDateEndAt=…` memakai `genius_filter` dari langkah 1,
   dengan `includeData` supaya `listingPerson`, `sellingPerson`, `coListingPersons`, `coSellingPersons` ikut. Baca semua halaman.
3. Kelompokkan closing per `office_code`: cocokkan `.office.officeCode` di **semua pihak**, bukan hanya awalan Closing ID.
   Satu `office_code` bisa dipakai beberapa cabang: kirim daftar yang sama ke tiap cabang.
4. `POST /closings/status` untuk membuang closing yang statusnya `reported`.
5. Kirim WA ke `send_to`, lalu `POST /reminder-log`.
   - `mode: "genius"`: daftar Closing ID bernomor, minta balas nomor yang sudah fix, `semua`, atau `nihil`.
   - `mode: "excel"`: minta upload file laporan ke `drive_url`. Tidak perlu tarik Genius.
6. Saat admin membalas, `POST /closing-confirmations`, lalu teruskan `message` dari respons ke admin.

Closing yang belum dikonfirmasi tetap muncul lagi di tanggal kirim berikutnya selama periodenya terbuka.

## 1. `GET /reminders/due`

Kantor yang perlu dikirimi reminder **sekarang**: tanggal dan jam WIB cocok dengan jadwal di web (halaman *Periode & Cut-off*),
bot aktif, dan ada periode terbuka. `?preview=1` mengabaikan jadwal dan "sudah dikirim hari ini" (hanya untuk uji).

```json
{
  "date": "2026-11-01", "preview": false, "active": true, "send_days": [25, 1, 3], "send_hour": 9,
  "period": "2026-10", "cutoff_at": "2026-11-03T16:59:00.000Z",
  "genius_filter": { "filterClosingDateStartAt": "2026-10-01", "filterClosingDateEndAt": "2026-10-31" },
  "offices": [
    { "cabang_id": "uuid", "office_code": "F21002", "cabang_name": "…", "induk_name": "…", "mode": "genius",
      "send_to": "+62812…", "contact_jenis": "admin", "has_lines": false },
    { "cabang_id": "uuid", "office_code": "F31005", "cabang_name": "…", "induk_name": "…", "mode": "excel",
      "send_to": "+62813…", "contact_jenis": "bo", "has_lines": false, "drive_url": "https://drive.google.com/…" }
  ],
  "skipped": [ { "cabang_id": "uuid", "cabang_name": "…", "reason": "tidak ada nomor WA kontak" } ]
}
```

- **Periode tujuan:** periode yang sudah mulai dan masih terbuka dengan cut-off terdekat. Dikendalikan dari dashboard: kalau HQ
  membuka kunci September, fokus pindah ke September.
- **Tidak ikut:** kantor yang sudah ditandai Nihil, kantor Excel yang filenya sudah diunggah HQ, kantor yang sudah dikirimi hari itu,
  dan kantor tanpa nomor WA (masuk `skipped`).
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
  "sent_to": "+62812…", "closing_codes": ["C26F31001/0201"], "message_id": "wamid.xxx" }
```
Respons: `{ "status": "ok", "duplicate": false }`. `message_id` yang sama tidak dicatat dua kali (`duplicate: true`).
Web menampilkan "WA reminder 25 Okt 09:00" di halaman Rekonsiliasi.

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
- `excel_uploaded`: admin bilang sudah upload ke Drive. Hanya dicatat; HQ mengunggah file lewat halaman Upload.

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
