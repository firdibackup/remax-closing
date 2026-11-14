-- Reminder WhatsApp lewat bot Hermes (PLAN §11a). Web = sumber jadwal, kontak, dan validasi; Hermes = pengirim WA.

-- Satu baris pengaturan (id selalu true).
create table if not exists closing.bot_settings (
  id boolean primary key default true check (id),
  active boolean not null default false,
  send_days int[] not null default '{25,1,3}',          -- tanggal kirim (WIB)
  send_hour int not null default 9 check (send_hour between 0 and 23),
  drive_url text,                                       -- folder Google Drive untuk kantor Excel
  updated_at timestamptz not null default now()
);
insert into closing.bot_settings (id) values (true) on conflict (id) do nothing;

-- Reminder yang sudah dikirim Hermes (POST /api/bot/reminder-log).
create table if not exists closing.reminder_log (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references closing.periods(id),
  cabang_id uuid not null references closing.offices(id),
  mode text not null check (mode in ('genius', 'excel')),
  sent_at timestamptz not null,
  sent_to text,
  closing_codes text[] not null default '{}',
  message_id text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists reminder_log_period_cabang on closing.reminder_log (period_id, cabang_id, sent_at desc);

-- Balasan admin kantor yang sudah diolah Hermes (POST /api/bot/closing-confirmations).
create table if not exists closing.bot_confirmations (
  id uuid primary key default gen_random_uuid(),
  period_id uuid references closing.periods(id),
  cabang_id uuid not null references closing.offices(id),
  kind text not null check (kind in ('closings', 'nihil', 'excel_uploaded')),
  reply_from text,
  confirmed_codes text[] not null default '{}',
  raw_reply text,
  message_id text not null unique,
  replied_at timestamptz,
  -- processing = sedang diproses (baris dibuat dulu supaya retry dengan message_id sama tidak diproses dua kali)
  status text not null check (status in ('processing', 'saved', 'partial', 'held', 'rejected', 'noted')),
  result jsonb not null default '{}'::jsonb,           -- respons yang dikirim balik ke Hermes
  created_at timestamptz not null default now()
);
create index if not exists bot_confirmations_period_cabang on closing.bot_confirmations (period_id, cabang_id, created_at desc);

grant select, insert, update, delete on closing.bot_settings, closing.reminder_log, closing.bot_confirmations to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['bot_settings', 'reminder_log', 'bot_confirmations'] loop
    execute format('alter table closing.%I enable row level security', t);
    execute format('drop policy if exists superadmin_all on closing.%I', t);
    execute format('create policy superadmin_all on closing.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
