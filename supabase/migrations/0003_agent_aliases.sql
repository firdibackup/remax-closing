-- Nama lain agen di file Excel kantor ("Linawati" untuk LINAWATY). Diisi saat HQ memilih saran nama mirip di halaman Upload,
-- supaya upload bulan berikutnya langsung cocok. sheet_name tetap nama laporan utama.
alter table closing.agents add column if not exists aliases text[] not null default '{}';
