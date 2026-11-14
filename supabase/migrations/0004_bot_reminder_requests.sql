-- Antrean kirim reminder WA. Hermes menanyakan GET /api/bot/reminders/due tiap 5 menit; web memberi kantor yang perlu
-- dikirimi dan mencatat "sedang diambil" di sini supaya satu kantor tidak terkirim dua kali.
--   schedule      = reminder terjadwal (satu baris per kantor per hari, schedule_day = tanggal WIB)
--   manual        = HQ klik "Ingatkan sekarang" di Beranda
--   drive_missing = HQ klik "File tidak ada" (kantor Excel bilang sudah upload, tapi file tidak ada/salah di Drive)
create table if not exists closing.bot_reminder_requests (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references closing.periods(id),
  cabang_id uuid not null references closing.offices(id),
  trigger text not null check (trigger in ('schedule', 'manual', 'drive_missing')),
  schedule_day date,
  requested_by text not null default 'superadmin',
  created_at timestamptz not null default now(),
  claimed_at timestamptz,                -- terakhir diberikan ke Hermes
  attempts int not null default 0,       -- berapa kali diberikan; dibatasi supaya kantor tidak dibanjiri pesan
  done_at timestamptz,                   -- Hermes melapor terkirim (POST /api/bot/reminder-log)
  message_id text,
  cancelled_at timestamptz,
  cancel_reason text,
  check ((trigger = 'schedule') = (schedule_day is not null))
);
-- schedule_day null untuk manual/drive_missing, jadi unik hanya berlaku untuk baris terjadwal.
create unique index if not exists bot_reminder_requests_schedule_day on closing.bot_reminder_requests (period_id, cabang_id, schedule_day);
create index if not exists bot_reminder_requests_period_cabang on closing.bot_reminder_requests (period_id, cabang_id, created_at desc);

grant select, insert, update, delete on closing.bot_reminder_requests to authenticated, service_role;
alter table closing.bot_reminder_requests enable row level security;
drop policy if exists superadmin_all on closing.bot_reminder_requests;
create policy superadmin_all on closing.bot_reminder_requests for all to authenticated using (true) with check (true);
