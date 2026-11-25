-- Impor Data Tahunan (Master Data per tahun, sheet "2025", "2026", …) + Verifikasi kantor & MA.
-- File tahunan hanya berisi nama (kantor induk, cabang, MA), tanpa Office ID / Agent ID. Alurnya:
--   1. Upload → semua baris masuk staging (yearly_import_rows), satu impor per tahun (upload ulang = ganti).
--   2. Nama cabang → kantor lewat office_name_map; nama MA per kantor → agen lewat agent_name_map.
--      Keduanya dipakai ulang lintas tahun. Yang cocok persis diisi otomatis (created_by = 'auto'), sisanya oleh HQ.
--   3. Baris yang kantor DAN agennya sudah jelas diterbitkan ke commission_lines (source = 'import',
--      import_batch_id = impor tahunannya); sisanya "ditahan" di staging sampai diverifikasi.
-- Id baris commission_lines terbitan = id baris staging, jadi terbit ulang memperbarui baris yang sama (tidak dobel).
-- line_id terisi saat terbit dan otomatis kosong lagi kalau barisnya dihapus (on delete set null).

create table if not exists closing.yearly_imports (
  id uuid primary key default gen_random_uuid(),
  year int not null unique check (year between 2000 and 2100),
  source_file text,
  sheet text,
  total_rows int not null default 0,
  skipped_rows int not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table closing.commission_lines
  add column if not exists import_batch_id uuid references closing.yearly_imports(id) on delete cascade;
create index if not exists commission_lines_import_batch_idx on closing.commission_lines (import_batch_id);

create table if not exists closing.yearly_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references closing.yearly_imports(id) on delete cascade,
  row_no int not null,                          -- nomor baris di sheet
  month int not null check (month between 1 and 12),
  induk_raw text,                               -- kolom Office Name (PREMIER)
  cabang_raw text not null,                     -- kolom RE/MAX (PREMIER_JGC, 360 (MPS))
  ma_raw text not null,
  office_key text not null,                     -- nama cabang ternormalisasi (kunci office_name_map)
  ma_key text not null,                         -- nama MA ternormalisasi (kunci agent_name_map)
  bayar_via text,
  plafond_kpr numeric(18, 2),
  res_comm text,
  solo_cobroke text,
  psr text,
  lsl text,
  nilai_transaksi numeric(18, 2) not null default 0,
  komisi_gross numeric(18, 2) not null default 0,
  alamat text,
  kantor_cobroke text,
  ma_cobroke text,
  file_amounts jsonb not null default '{}'::jsonb, -- royalti/PPN/SSDF/PPh/ke RMI/net apa adanya di file (pembanding)
  line_id uuid references closing.commission_lines(id) on delete set null
);
create index if not exists yearly_import_rows_import_idx on closing.yearly_import_rows (import_id);
create index if not exists yearly_import_rows_keys_idx on closing.yearly_import_rows (office_key, ma_key);

create table if not exists closing.office_name_map (
  name_key text primary key,
  office_id uuid not null references closing.offices(id) on delete cascade,
  created_by text,                              -- 'auto' = cocok persis saat upload; selain itu HQ
  created_at timestamptz not null default now()
);

-- Per kantor: "Cynthia" di PREMIER bukan "Cynthia" di kantor lain.
create table if not exists closing.agent_name_map (
  office_id uuid not null references closing.offices(id) on delete cascade,
  name_key text not null,
  agent_id uuid not null references closing.agents(id) on delete cascade,
  created_by text,                              -- 'auto' = cocok persis saat upload; selain itu HQ
  created_at timestamptz not null default now(),
  primary key (office_id, name_key)
);
create index if not exists agent_name_map_agent_idx on closing.agent_name_map (agent_id);

grant select, insert, update, delete on closing.yearly_imports, closing.yearly_import_rows, closing.office_name_map, closing.agent_name_map
  to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['yearly_imports', 'yearly_import_rows', 'office_name_map', 'agent_name_map'] loop
    execute format('alter table closing.%I enable row level security', t);
    execute format('drop policy if exists superadmin_all on closing.%I', t);
    execute format('create policy superadmin_all on closing.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
