-- Schema aplikasi REMAX Reporting Closing (PLAN.md §7). Hanya menyentuh schema `closing`.

create schema if not exists closing;
create extension if not exists btree_gist with schema extensions;

create table if not exists closing.offices (
  id uuid primary key default gen_random_uuid(),
  genius_office_id text,
  office_code text not null,                   -- F31001 (bisa >1 cabang, mis. F21002)
  induk_name text not null,                    -- EAGLE
  cabang_name text not null unique,            -- EAGLE_CITRALAND
  kategori text not null check (kategori in ('3.5', '9')),
  royalty_rate numeric(6, 4) not null,
  ssdf_rate numeric(6, 4) not null,
  status text not null default 'aktif' check (status in ('aktif', 'tutup')),
  report_channel text not null default 'GENIUS' check (report_channel in ('GENIUS', 'EXCEL', 'NIHIL')),
  alamat text,
  catatan text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists closing.agents (
  id uuid primary key default gen_random_uuid(),
  employee_code text not null unique,          -- A24277
  name text not null,
  full_name text,
  sheet_name text,
  role text not null default 'agent_property' check (role in ('agent_property', 'franchise_owner')),
  status text not null default 'aktif' check (status in ('aktif', 'resign')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists closing.office_contacts (
  id uuid primary key default gen_random_uuid(),
  office_id uuid not null references closing.offices(id) on delete cascade,
  jenis text not null check (jenis in ('admin', 'bo', 'franchise_owner', 'lainnya')),
  nama text,
  phone text,
  email text,
  is_primary boolean not null default false,
  agent_id uuid references closing.agents(id),
  catatan text
);

create table if not exists closing.agent_assignments (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references closing.agents(id) on delete cascade,
  office_id uuid not null references closing.offices(id),
  start_date date not null,
  end_date date,
  alasan text not null default 'awal' check (alasan in ('awal', 'transfer', 'koreksi')),
  created_by text,
  created_at timestamptz not null default now(),
  constraint agent_assignments_no_overlap exclude using gist (
    agent_id with =, daterange(start_date, end_date, '[]') with &&
  )
);

create table if not exists closing.periods (
  id uuid primary key default gen_random_uuid(),
  year int not null,
  month int not null check (month between 1 and 12),
  cutoff_at timestamptz,
  status text not null default 'open' check (status in ('open', 'locked')),
  locked_by text,
  locked_at timestamptz,
  unique (year, month)
);

create table if not exists closing.closings (
  id uuid primary key default gen_random_uuid(),
  genius_closing_id text unique,
  closing_code text not null unique,           -- C26F31001/0170
  closing_date date,
  closing_type text,
  payment_type text,
  bank_kpr text,
  selling_price numeric(18, 2),
  dpp_amount numeric(18, 2),
  dpp_percentage numeric(6, 3),
  commission_type text,
  sell_or_rent text,
  listing_type text,
  listing_part text,
  listing_title text,
  genius_status text,
  snapshot jsonb not null default '{}'::jsonb,  -- tanpa NIK/email/telepon
  fetched_at timestamptz not null default now()
);

create table if not exists closing.closing_persons (
  id uuid primary key default gen_random_uuid(),
  closing_id uuid not null references closing.closings(id) on delete cascade,
  side text not null check (side in ('listing', 'selling', 'co_listing', 'co_selling')),
  person_type text not null check (person_type in ('INTERNAL', 'EXTERNAL')),
  office_code text,
  office_name text,
  employee_code text,
  agent_name text,
  commission_amount numeric(18, 2) not null default 0,
  royalty_rate_genius numeric(6, 4),
  ssdf_rate_genius numeric(6, 4),
  royalty_real_genius numeric(18, 2),
  ssdf_real_genius numeric(18, 2)
);

create table if not exists closing.invoices (
  id uuid primary key default gen_random_uuid(),
  genius_invoice_id text unique,
  invoice_number text not null unique,         -- I26F31001/0168
  closing_id uuid not null references closing.closings(id) on delete cascade,
  phase int,
  total_phase int,
  percentage numeric(6, 3),
  amount numeric(18, 2),
  canceled_at timestamptz,
  fetched_at timestamptz not null default now()
  -- status bayar (PAID/UNPAID) sengaja tidak disimpan (PLAN §3.5a)
);

create table if not exists closing.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_file text not null,
  sheet text,
  rows int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists closing.report_entries (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references closing.periods(id),
  cabang_id uuid not null references closing.offices(id),
  invoice_id uuid references closing.invoices(id),
  closing_id uuid references closing.closings(id),
  source text not null check (source in ('input', 'import', 'wa_bot')),
  input_by text,
  input_at timestamptz not null default now(),
  note text,
  unique (invoice_id, cabang_id)
);

create table if not exists closing.commission_lines (
  id uuid primary key default gen_random_uuid(),
  period_id uuid not null references closing.periods(id),
  cabang_id uuid not null references closing.offices(id),   -- snapshot saat disimpan
  report_entry_id uuid references closing.report_entries(id) on delete cascade,
  source text not null check (source in ('genius', 'import', 'excel', 'manual')),
  closing_code text,
  invoice_number text,
  tanggal_transaksi date,
  bayar_via text,
  plafond_kpr numeric(18, 2),
  res_comm text,
  solo_cobroke text,
  psr text,
  lsl text,
  ma_name text,
  agent_id uuid references closing.agents(id),
  nilai_transaksi numeric(18, 2) not null default 0,
  alamat text,
  kantor_cobroke text,
  ma_cobroke text,
  komisi_pct numeric(6, 4),
  komisi_gross numeric(18, 2) not null default 0,
  royalty_rate numeric(6, 4) not null,
  ssdf_rate numeric(6, 4) not null,
  royalti numeric(18, 2) not null default 0,
  ppn_royalti numeric(18, 2) not null default 0,
  pph_royalti numeric(18, 2) not null default 0,
  total_royalti numeric(18, 2) not null default 0,
  ssdf numeric(18, 2) not null default 0,
  ppn_ssdf numeric(18, 2) not null default 0,
  pph_ssdf numeric(18, 2) not null default 0,
  total_ssdf numeric(18, 2) not null default 0,
  ke_rmi numeric(18, 2) not null default 0,
  net_komisi numeric(18, 2) not null default 0,
  original jsonb,
  batal_at timestamptz,                         -- batal/ubah (PLAN §9a): baris tidak dihapus
  diganti_oleh uuid,
  created_at timestamptz not null default now()
);

create table if not exists closing.recon_status (
  period_id uuid not null references closing.periods(id),
  cabang_id uuid not null references closing.offices(id),
  status text not null check (status in ('Done', 'Selisih', 'Belum kirim', 'Nihil')),
  catatan text,
  checked_by text,
  checked_at timestamptz,
  primary key (period_id, cabang_id)
);

create table if not exists closing.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text,
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  at timestamptz not null default now()
);

-- Akses: satu superadmin login (authenticated). anon tidak punya akses data.
grant usage on schema closing to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema closing to authenticated, service_role;
grant usage, select on all sequences in schema closing to authenticated, service_role;
alter default privileges in schema closing grant select, insert, update, delete on tables to authenticated, service_role;

do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'closing' loop
    execute format('alter table closing.%I enable row level security', t);
    execute format('drop policy if exists superadmin_all on closing.%I', t);
    execute format('create policy superadmin_all on closing.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;
