-- Foto MA untuk poster Top 10 MA. Satu baris per agen master; berkasnya di Storage bucket privat ma-photos.
--   source = genius : diambil sekali dari profil Genius (user.profilePic), lalu dipakai ulang tiap bulan
--   source = manual : diupload HQ (PNG cutout); selalu menang dari foto Genius
-- path null = foto Genius tidak ada / tidak bisa diunduh (alasan di note), supaya Genius tidak ditanya ulang tiap render.
-- transparent = latar foto sudah transparan (cutout). false = masih berlatar → poster diberi peringatan "perlu cutout".
create table if not exists closing.agent_photos (
  agent_id uuid primary key references closing.agents(id) on delete cascade,
  source text not null check (source in ('genius', 'manual')),
  path text,
  transparent boolean not null default false,
  genius_url text,
  note text,
  updated_at timestamptz not null default now(),
  check (source = 'genius' or path is not null)
);

grant select, insert, update, delete on closing.agent_photos to authenticated, service_role;
alter table closing.agent_photos enable row level security;
drop policy if exists superadmin_all on closing.agent_photos;
create policy superadmin_all on closing.agent_photos for all to authenticated using (true) with check (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ma-photos', 'ma-photos', false, 10485760, array['image/png', 'image/jpeg'])
on conflict (id) do nothing;
