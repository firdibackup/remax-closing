import "server-only";

import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { fetchActiveLines } from "@/lib/supabase/fetch-lines";
import { cached } from "@/lib/closing/cache";
import { defaultPeriod, periodState, type PeriodLike } from "@/lib/closing/periods";

// Data periode & status lapor kantor (Beranda, sidebar, Input, Upload).
export type PeriodRow = PeriodLike & { id: string; locked_at: string | null; locked_by: string | null };
export type ReportState = "lapor" | "nihil" | "belum";
export type OfficeLite = { id: string; office_code: string; cabang_name: string; induk_name: string; kategori: string; report_channel: string | null; status: string };

export const loadPeriods = (): Promise<PeriodRow[]> => cached("periods", fetchPeriods);
async function fetchPeriods(): Promise<PeriodRow[]> {
  const { data, error } = await supabaseClosingAdmin().from("periods").select("id,year,month,status,cutoff_at,locked_at,locked_by").order("year").order("month");
  if (error) throw new Error(`Gagal baca periode: ${error.message}`);
  return (data ?? []) as PeriodRow[];
}

// ?bulan=N → periode bulan itu (tahun terakhir); selain itu periode kerja default.
export function pickPeriod(list: PeriodRow[], bulan?: string): PeriodRow | undefined {
  const m = Number(bulan);
  return list.filter((p) => p.month === m).at(-1) ?? defaultPeriod(list);
}

export const periodValue = (p: PeriodLike) => `${p.year}-${String(p.month).padStart(2, "0")}`;

export const loadActiveOffices = (): Promise<OfficeLite[]> => cached("active-offices", fetchActiveOffices);
async function fetchActiveOffices(): Promise<OfficeLite[]> {
  const { data, error } = await supabaseClosingAdmin().from("offices").select("id,office_code,cabang_name,induk_name,kategori,report_channel,status").eq("status", "aktif").order("cabang_name").limit(1000);
  if (error) throw new Error(`Gagal baca kantor: ${error.message}`);
  return (data ?? []) as OfficeLite[];
}

// Kantor yang ditandai Nihil (tidak ada closing) di periode ini; disimpan di recon_status.
export const nihilOfficeIds = (periodId: string): Promise<Set<string>> => cached(`nihil:${periodId}`, () => fetchNihil(periodId));
async function fetchNihil(periodId: string): Promise<Set<string>> {
  const { data, error } = await supabaseClosingAdmin().from("recon_status").select("cabang_id").eq("period_id", periodId).eq("status", "Nihil");
  if (error) throw new Error(`Gagal baca status nihil: ${error.message}`);
  return new Set((data ?? []).map((r) => r.cabang_id as string));
}

export const reportState = (officeId: string, reported: Set<string>, nihil: Set<string>): ReportState =>
  reported.has(officeId) ? "lapor" : nihil.has(officeId) ? "nihil" : "belum";

// Badge sidebar: jumlah kantor aktif yang belum lapor/nihil di periode kerja yang masih terbuka.
export async function pendingOfficeCount(): Promise<number> {
  const p = defaultPeriod(await loadPeriods());
  if (!p || periodState(p) !== "open") return 0;
  // Baris periode diambil dari cache commission_lines (sama dengan yang dipakai halaman), bukan query terpisah.
  const [offices, lines, nihil] = await Promise.all([loadActiveOffices(), fetchActiveLines(), nihilOfficeIds(p.id)]);
  const reported = new Set(lines.filter((l) => l.periods?.id === p.id).map((l) => l.cabang_id));
  return offices.filter((o) => reportState(o.id, reported, nihil) === "belum").length;
}
