import "server-only";

import { fetchActiveLines } from "@/lib/supabase/fetch-lines";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { rankMa, type MaRow } from "@/lib/closing/rekap";
import { posterName, posterOffice } from "@/lib/top-ma/format";
import { ensurePhotos, type PhotoRow } from "@/lib/top-ma/photos";
import { TEMPLATE_RANKS, type PosterTemplate } from "@/lib/top-ma/render";

// Peringkat Top MA (halaman /top-ma) dan isi poster Top 10 / Top 50. Satu sumber supaya poster = tabel di halaman.

export const ROLES: [string, string][] = [["", "Semua role"], ["agent_property", "Agent Property"], ["franchise_owner", "Franchise Owner"]];
export type TopMaFilter = { month: number; ind?: string; role?: string };
export type RankedMa = MaRow & { role: string };

export const parseRole = (r: string | undefined) => (ROLES.some(([v]) => v === r) ? r ?? "" : "");

type AgentInfo = { id: string; role: string; employee_code: string; name: string };

export async function loadRanking(f: TopMaFilter) {
  const db = supabaseClosingAdmin();
  const [rows, aRes, asRes] = await Promise.all([
    fetchActiveLines(),
    db.from("agents").select("id,role,employee_code,name").limit(5000),
    db.from("agent_assignments").select("agent_id").limit(10000),
  ]);
  if (aRes.error) throw new Error(`Gagal baca agen: ${aRes.error.message}`);
  if (asRes.error) throw new Error(`Gagal baca riwayat kantor agen: ${asRes.error.message}`);
  const agents = new Map((aRes.data as AgentInfo[]).map((a) => [a.id, a]));
  const nAssign = new Map<string, number>();
  for (const a of asRes.data ?? []) nAssign.set(a.agent_id as string, (nAssign.get(a.agent_id as string) ?? 0) + 1);
  const inds = [...new Set(rows.map((r) => r.offices?.induk_name ?? ""))].filter(Boolean).sort();
  // Baris tanpa agent_id (agen belum di master) dianggap Agent Property.
  const ranked: RankedMa[] = rankMa(rows, { month: f.month, ind: f.ind })
    .map((r) => ({ ...r, role: (r.agentId && agents.get(r.agentId)?.role) || "agent_property" }))
    .filter((r) => !f.role || r.role === f.role);
  const year = rows.find((r) => r.periods)?.periods?.year ?? 2026;
  const monthsWithData = [...new Set(rows.map((r) => r.periods?.month ?? 0))].filter(Boolean).sort((a, b) => a - b);
  return { ranked, year, inds, nAssign, agents, monthsWithData };
}

export type PhotoState = "manual" | "genius" | "none";
export type PosterEntry = {
  rank: number;
  agentId: string | null;
  employeeCode: string | null;
  ma: string; // nama di laporan
  induk: string;
  gc: number;
  name: string; // default nama poster: nama panggilan master
  office: string; // default kantor poster: "REMAX <Induk>"
  photo: { state: PhotoState; transparent: boolean; path: string | null; note: string | null; updatedAt: string | null };
};

const photoOf = (row: PhotoRow | undefined, inMaster: boolean): PosterEntry["photo"] => {
  if (!inMaster) return { state: "none", transparent: false, path: null, note: "Agen belum ada di master, foto tidak bisa dicari.", updatedAt: null };
  if (!row) return { state: "none", transparent: false, path: null, note: "Foto belum diambil dari Genius.", updatedAt: null };
  if (!row.path) return { state: "none", transparent: false, path: null, note: row.note, updatedAt: row.updated_at };
  return { state: row.source, transparent: row.transparent, path: row.path, note: row.note, updatedAt: row.updated_at };
};

// Isi satu poster: Top 10 = peringkat 1–10, Top 50 = peringkat 11–50 (template Top 50 tidak memuat 10 besar).
// Foto yang belum pernah diambil dicari ke Genius sekarang (sekali, lalu tersimpan).
export async function loadPosterEntries(f: TopMaFilter, template: PosterTemplate): Promise<{ year: number; entries: PosterEntry[]; geniusErrors: string[] }> {
  const { ranked, year, agents } = await loadRanking(f);
  const { from, to } = TEMPLATE_RANKS[template];
  const top = ranked.slice(from - 1, to);
  const refs = top.flatMap((r) => (r.agentId && agents.get(r.agentId) ? [{ id: r.agentId, employee_code: agents.get(r.agentId)!.employee_code }] : []));
  const { rows, errors } = await ensurePhotos(refs);
  const entries = top.map((r, i): PosterEntry => {
    const a = r.agentId ? agents.get(r.agentId) : undefined;
    return {
      rank: from + i,
      agentId: a ? a.id : null,
      employeeCode: a?.employee_code ?? null,
      ma: r.ma,
      induk: r.induk,
      gc: r.gc,
      name: posterName(a?.name || r.ma),
      office: posterOffice(r.induk),
      photo: photoOf(a ? rows.get(a.id) : undefined, !!a),
    };
  });
  return { year, entries, geniusErrors: errors };
}
