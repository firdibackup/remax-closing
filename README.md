# REMAX HQ Reporting Closing

Web internal REMAX HQ untuk laporan closing bulanan: tarik closing dari Genius, hitung royalti & SSDF per agen/kantor,
laporan 3,5% / 9%, rekonsiliasi finance, Data 2026, GC Office, dan Top MA. Rencana lengkap: `../remax/PLAN.md`.

Next.js 16 (App Router) + Supabase (schema `closing`, terpisah dari tabel REMAX Giving).

## Menjalankan

```bash
npm install
scripts/run-local.sh build   # build lalu jalan di http://localhost:3100
scripts/run-local.sh         # jalan tanpa build ulang
```

`run-local.sh` memuat kunci dari penyimpanan kunci OpenBot, jadi kunci rahasia tidak ditulis ke folder proyek.
Build ulang setiap kali `NEXT_PUBLIC_*` berubah, karena nilainya ditanam saat build.

`npm run dev` juga bisa dipakai, tapi `SUPABASE_SERVICE_ROLE_KEY` harus ada di environment (mis. di `.env`, yang sudah di-gitignore).

## Environment

| Variabel | Isi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL Supabase (`.env`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | publishable key, untuk login |
| `SUPABASE_SERVICE_ROLE_KEY` | service role, hanya di server |
| `GENIUS_EMAIL`, `GENIUS_PASSWORD`, `GENIUS_BASE_URL` | akun Genius (read-only) |
| `ADMIN_EMAILS` | email Supabase Auth yang boleh login, dipisah koma |
| `FINANCE_TOKEN` | opsional, min. 24 karakter; link baca-saja finance. Ganti nilainya untuk mencabut link |

## Akses

- **Superadmin**: login di `/login` dengan akun Supabase Auth yang emailnya ada di `ADMIN_EMAILS`.
  Proxy (`src/proxy.ts`) memverifikasi sesi untuk semua halaman, ekspor, dan server action.
- **Finance**: link `…/rekon?akses=<FINANCE_TOKEN>` (ada di halaman Rekonsiliasi). Hanya Laporan & Rekonsiliasi,
  hanya baca, tanpa kontak kantor. Bisa juga dikirimi PDF (tombol *Cetak / PDF*) atau file `.xlsx`.

## Aturan penting

- **Cut-off**: periode bulan X terbuka sampai tanggal 3 bulan berikutnya 23:59 WIB, lalu terkunci otomatis.
  Buka kunci di *Periode & Cut-off* dengan batas baru; setelah lewat, terkunci lagi.
- **Invoice tidak dihitung dua kali**: invoice yang sudah punya baris aktif, atau ditandai dari impor
  *List Data Office*, dilewati saat input.
- **Master tidak diisi otomatis**: agen/kantor yang belum dikenal menahan closing sampai ditambahkan
  (tombol *Tambahkan ke master* di pratinjau Input).
- **Upload Excel kantor**: komisi dihitung ulang dengan tarif kantor di master; angka di file hanya pembanding.
  Upload ulang untuk kantor + periode yang sama menggantikan upload sebelumnya.

## Poster Top MA (All Office)

*Top MA* → pilih satu bulan (Office: semua) → *Poster Top MA 2026 All Office*. Drawer dua langkah: Top 10 (peringkat
1–10, 4018×5440) lalu Top 50 (peringkat 11–50, 4018×7857), masing-masing pratinjau + unduh PNG/JPG. Template dari
desainer ada di `src/lib/top-ma/assets` (salinan "Template Layout Top MA"; posisi di `top10.json` / `top50.json`).
Tombol nonaktif kalau office tertentu dipilih: poster per office nanti memakai template sendiri.

- **Peringkat** sama dengan tabel Top MA (`loadRanking` di `src/lib/top-ma/data.ts`).
- **Nama** = nama panggilan master (`agents.name`), **kantor** = "REMAX " + office induk. Keduanya bisa diubah di
  halaman poster sebelum unduh (tidak disimpan). Teks kepanjangan otomatis dikecilkan.
- **Foto** disimpan per agen (`closing.agent_photos` + bucket privat `ma-photos`, migrasi 0006) dan dipakai lagi bulan
  berikutnya. Agen yang belum punya catatan foto diambil sekali dari profil Genius (`user.profilePic`; URL S3 dibaca
  lewat host `akses.file.di.awanku.net`). Banyak foto Genius masih berlatar atau tidak bisa diunduh, jadi HQ upload
  PNG cutout (maks 5 MB) di halaman poster; upload manual selalu menang. *Ambil ulang dari Genius* hanya mengganti
  foto kalau Genius benar-benar punya foto.

## Impor data

Semua skrip memakai `SUPABASE_SERVICE_ROLE_KEY` dari environment dan aman dijalankan ulang.

```bash
cd scripts
export SUPABASE_SERVICE_ROLE_KEY="$(cat "<penyimpanan kunci OpenBot>/SUPABASE_SERVICE_ROLE_KEY")"
python3 import_master.py <Master_Data.xlsx>        # List Office + List Agent
python3 import_2026.py <Master_Data.xlsx>          # sheet 2026 → baris historis
python3 import_contacts.py <contacts.json>         # kontak kantor + alamat
python3 import_reported.py "<List Data Office REPORT Closing.xlsx>"  # invoice yang sudah dilaporkan + status rekon
```

Pemetaan nama kantor yang tidak sama persis ada di `scripts/office_names.py` (`ALIASES`).

## Test

```bash
npm test                                   # unit test (node:test): rumus komisi, cut-off, telepon, parser Excel, teks poster
python3 scripts/import_reported.py --selftest
python3 scripts/import_contacts.py --selftest
python3 scripts/office_names.py
```

Skema database: `supabase/migrations/` (0001–0006 sudah diterapkan di Supabase).
