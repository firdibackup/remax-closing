-- Impor Data Tahunan jadi dua tahap: draft → final.
--   draft: baris hanya di staging (yearly_import_rows). Kantor & MA diverifikasi di halaman Verifikasi; peta nama
--          (office_name_map, agent_name_map) boleh berubah, tetapi BELUM ada satu pun baris di commission_lines.
--   final: setelah semua kantor dan MA terverifikasi, HQ menekan "Simpan ke laporan" → 12 periode tahun itu dibuat
--          (terkunci) dan semua baris diterbitkan sekaligus ke commission_lines (import_batch_id = impor ini).
-- Impor yang sudah ada sebelum migrasi ini dikembalikan ke draft (baris terbitannya dihapus) supaya tidak ada
-- tahun yang setengah masuk laporan.

alter table closing.yearly_imports add column if not exists status text not null default 'draft';
alter table closing.yearly_imports add column if not exists finalized_at timestamptz;
alter table closing.yearly_imports add column if not exists finalized_by text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'yearly_imports_status_check') then
    alter table closing.yearly_imports add constraint yearly_imports_status_check check (status in ('draft', 'final'));
  end if;
end $$;

-- Kembalikan impor lama (belum pernah final) ke draft: tarik baris terbitannya.
delete from closing.commission_lines c
using closing.yearly_imports y
where c.import_batch_id = y.id and y.status = 'draft';

-- Periode yang dibuat impor draft lama dan tidak dipakai apa pun dihapus lagi (dibuat ulang saat final).
delete from closing.periods p
where p.locked_by = 'superadmin'
  and exists (select 1 from closing.yearly_imports y where y.year = p.year and y.status = 'draft')
  and not exists (select 1 from closing.commission_lines c where c.period_id = p.id)
  and not exists (select 1 from closing.report_entries r where r.period_id = p.id)
  and not exists (select 1 from closing.recon_status r where r.period_id = p.id)
  and not exists (select 1 from closing.reminder_log r where r.period_id = p.id)
  and not exists (select 1 from closing.bot_confirmations r where r.period_id = p.id)
  and not exists (select 1 from closing.bot_reminder_requests r where r.period_id = p.id);

notify pgrst, 'reload schema';
