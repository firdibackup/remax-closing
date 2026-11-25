import "server-only";

import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { cached } from "@/lib/closing/cache";

// PostgREST membatasi 1.000 baris per request, jadi data dibaca per halaman sampai habis.
const PAGE_SIZE = 1000;

// Periode di-embed dengan !inner supaya filter tahun/bulan (periods.year / periods.month) membatasi baris commission_lines.
export const LINE_SELECT =
  "id,source,cabang_id,agent_id,closing_code,invoice_number,komisi_gross,nilai_transaksi,ma_name,alamat,royalty_rate,bayar_via,res_comm,solo_cobroke,psr,lsl,kantor_cobroke,ma_cobroke,"
  + "royalti,ppn_royalti,pph_royalti,total_royalti,ssdf,ppn_ssdf,pph_ssdf,total_ssdf,ke_rmi,net_komisi,"
  + "tanggal_transaksi,plafond_kpr,komisi_pct,ssdf_rate,"
  + "genius_royalti:original->>genius_royalti,genius_ssdf:original->>genius_ssdf,upload_file:original->>file,"
  + "offices!cabang_id(induk_name,cabang_name),periods!period_id!inner(id,month,year,status)";

export type LineRow = {
  id: string;
  source: string;
  cabang_id: string;
  agent_id: string | null;
  closing_code: string | null;
  invoice_number: string | null;
  komisi_gross: number | string;
  nilai_transaksi: number | string;
  ma_name: string | null;
  alamat: string | null;
  royalty_rate: number | string;
  bayar_via: string | null;
  res_comm: string | null;
  solo_cobroke: string | null;
  psr: string | null;
  lsl: string | null;
  kantor_cobroke: string | null;
  ma_cobroke: string | null;
  royalti: number | string;
  ppn_royalti: number | string;
  pph_royalti: number | string;
  total_royalti: number | string;
  ssdf: number | string;
  ppn_ssdf: number | string;
  pph_ssdf: number | string;
  total_ssdf: number | string;
  ke_rmi: number | string;
  net_komisi: number | string;
  tanggal_transaksi: string | null;
  plafond_kpr: number | string | null;
  komisi_pct: number | string | null;
  ssdf_rate: number | string;
  genius_royalti: string | null; // pembanding rekon dari Genius (hanya baris input Genius)
  genius_ssdf: string | null;
  upload_file: string | null; // nama file upload Excel (baris source=excel)
  offices: { induk_name: string; cabang_name: string } | null;
  periods: { id: string; month: number; year: number; status: string } | null;
};

// Kategori diturunkan dari royalty_rate baris: 0,5% → 3,5% + PPN; 1% → 9% + PPN.
const KATEGORI_9_MIN_ROYALTY = 0.0075;
export const kategoriOf = (r: LineRow): "3.5" | "9" => (Number(r.royalty_rate) >= KATEGORI_9_MIN_ROYALTY ? "9" : "3.5");

// Filter halaman Data Tahunan (dipakai juga ekspor .xlsx): bulan, office induk, sumber, kata kunci (baris sudah per tahun).
export const SOURCES: [string, string][] = [["import", "Impor Master"], ["genius", "Genius"], ["excel", "Excel"], ["manual", "Manual"]];
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export type DataFilter = { month: number; ind?: string; src?: string; q?: string };
export function filterDataRows(rows: LineRow[], f: DataFilter): LineRow[] {
  const needle = norm(f.q);
  return rows.filter((r) =>
    (!f.month || r.periods?.month === f.month) &&
    (!f.ind || r.offices?.induk_name === f.ind) &&
    (!f.src || r.source === f.src) &&
    (!needle || [r.ma_name, r.alamat, r.offices?.cabang_name, r.kantor_cobroke, r.ma_cobroke, r.closing_code, r.invoice_number].some((x) => norm(x).includes(needle))));
}

// Semua baris satu tahun (periods.year) yang tidak dibatalkan (PLAN §9a), diurutkan stabil untuk paging. Di-cache per tahun
// (lib/closing/cache.ts; invalidateData() mengosongkan semua tahun): dipakai hampir semua halaman dan ±3 MB per unduhan.
// Hasilnya dibagi antar request, jadi jangan diubah di tempat.
export const fetchActiveLines = (year: number): Promise<LineRow[]> => cached(`active-lines:${year}`, () => loadActiveLines(year));

async function loadActiveLines(year: number): Promise<LineRow[]> {
  const db = supabaseClosingAdmin();
  const rows: LineRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("commission_lines")
      .select(LINE_SELECT)
      .eq("periods.year", year)
      .is("batal_at", null)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`Gagal baca commission_lines: ${error.message}`);
    const page = (data ?? []) as unknown as LineRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

// Baris yang dibatalkan untuk satu periode (daftar "Dibatalkan" + Pulihkan di Laporan Bulanan).
export async function fetchCancelledLines(year: number, month: number): Promise<(LineRow & { batal_at: string })[]> {
  const { data, error } = await supabaseClosingAdmin()
    .from("commission_lines")
    .select(`${LINE_SELECT},batal_at`)
    .eq("periods.year", year)
    .eq("periods.month", month)
    .not("batal_at", "is", null)
    .order("batal_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`Gagal baca baris batal: ${error.message}`);
  return (data ?? []) as unknown as (LineRow & { batal_at: string })[];
}
