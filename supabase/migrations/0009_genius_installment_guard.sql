-- Pemeriksaan pratinjau bisa bersamaan di dua tab atau di bot dan web.
-- Serialisasi penambahan/pemulihan baris Genius untuk closing yang sama.
create or replace function closing.guard_genius_installment()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.closing_code, 0));
  if exists (
    select 1 from closing.commission_lines l
    where l.closing_code = new.closing_code and l.batal_at is null
      and l.id <> new.id and l.invoice_number is not null
      and (
        (l.period_id = new.period_id and l.invoice_number <> new.invoice_number)
        or (l.invoice_number = new.invoice_number and
          (l.period_id <> new.period_id or
           (l.agent_id is not distinct from new.agent_id and l.cabang_id = new.cabang_id)))
      )
  ) then
    raise unique_violation using message = 'Termin closing sudah tercatat. Tarik ulang pratinjau.';
  end if;
  return new;
end;
$$;

create trigger guard_genius_installment
before insert or update of batal_at on closing.commission_lines
for each row when (new.source = 'genius' and new.batal_at is null and new.invoice_number is not null)
execute function closing.guard_genius_installment();
