import "server-only";

import { randomUUID } from "node:crypto";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { calcAmounts } from "@/lib/closing/calc";
import { agentIndex, maKey, matchOffice, officeKey, type AgentIndex } from "@/lib/yearly/match";
import type { FileAmounts, YearRow } from "@/lib/yearly/parse";

// Inti Impor Data Tahunan (tanpa UI): master + peta nama, isi peta otomatis, dan bentuk baris commission_lines dari
// staging. Selama impor masih draft TIDAK ada baris yang masuk laporan; semuanya diterbitkan sekaligus saat Simpan
// final (actions/yearly.ts → finalizeYearImport). Id baris commission_lines = id baris staging.

type Db = ReturnType<typeof supabaseClosingAdmin>;
const PAGE = 1000;
export const BATCH = 500;

export type OfficeRec = { id: string; office_code: string; cabang_name: string; induk_name: string; kategori: string; royalty_rate: number; ssdf_rate: number; status: string };
export type AgentRec = { id: string; employee_code: string; name: string; full_name: string | null; sheet_name: string | null; aliases: string[] | null; role: string; status: string };
type AssignmentRec = { agent_id: string; office_id: string; start_date: string; end_date: string | null };
type MapSource = "auto" | "hq";
const sourceOf = (createdBy: string | null): MapSource => (createdBy === "auto" ? "auto" : "hq");

export type Master = {
  offices: OfficeRec[];
  officeById: Map<string, OfficeRec>;
  agents: AgentRec[];
  agentById: Map<string, AgentRec>;
  assignments: AssignmentRec[];
  index: AgentIndex;
  officeMap: Map<string, { officeId: string; source: MapSource }>; // office_key → kantor
  agentMap: Map<string, { agentId: string; source: MapSource }>; // `${office_id}|${ma_key}` → agen
};
export const pairKey = (officeId: string, key: string) => `${officeId}|${key}`;

async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await q(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

export async function loadMaster(db: Db = supabaseClosingAdmin()): Promise<Master> {
  const [offices, agents, assignments, fo, om, am] = await Promise.all([
    all<OfficeRec>((a, b) => db.from("offices").select("id,office_code,cabang_name,induk_name,kategori,royalty_rate,ssdf_rate,status").order("id").range(a, b)),
    all<AgentRec>((a, b) => db.from("agents").select("id,employee_code,name,full_name,sheet_name,aliases,role,status").order("id").range(a, b)),
    all<AssignmentRec>((a, b) => db.from("agent_assignments").select("agent_id,office_id,start_date,end_date").order("id").range(a, b)),
    all<{ office_id: string; agent_id: string; nama: string | null }>((a, b) => db.from("office_contacts").select("office_id,agent_id,nama").eq("jenis", "franchise_owner").not("agent_id", "is", null).order("id").range(a, b)),
    all<{ name_key: string; office_id: string; created_by: string | null }>((a, b) => db.from("office_name_map").select("name_key,office_id,created_by").order("name_key").range(a, b)),
    all<{ office_id: string; name_key: string; agent_id: string; created_by: string | null }>((a, b) => db.from("agent_name_map").select("office_id,name_key,agent_id,created_by").order("office_id").order("name_key").range(a, b)),
  ]);
  const local = new Map<string, Set<string>>();
  for (const s of assignments) local.set(s.office_id, (local.get(s.office_id) ?? new Set()).add(s.agent_id));
  return {
    offices, officeById: new Map(offices.map((o) => [o.id, o])),
    agents, agentById: new Map(agents.map((a) => [a.id, a])),
    assignments,
    index: agentIndex(agents, local, fo),
    officeMap: new Map(om.map((m) => [m.name_key, { officeId: m.office_id, source: sourceOf(m.created_by) }])),
    agentMap: new Map(am.map((m) => [pairKey(m.office_id, m.name_key), { agentId: m.agent_id, source: sourceOf(m.created_by) }])),
  };
}

// Kantor & agen saat ini untuk satu baris (dari peta; belum termasuk saran otomatis yang belum disimpan).
export function resolveRow(m: Master, r: { office_key: string; ma_key: string }): { office: OfficeRec | null; agentId: string | null } {
  const officeId = m.officeMap.get(r.office_key)?.officeId;
  const office = officeId ? m.officeById.get(officeId) ?? null : null;
  return { office, agentId: office ? m.agentMap.get(pairKey(office.id, r.ma_key))?.agentId ?? null : null };
}

// Kantor saat ini (penugasan tanpa tanggal akhir, atau yang terakhir) per agen.
export function currentOffice(m: Master): Map<string, string> {
  const out = new Map<string, { office: string; start: string; open: boolean }>();
  for (const s of m.assignments) {
    const prev = out.get(s.agent_id);
    const open = !s.end_date;
    if (!prev || (open && !prev.open) || (open === prev.open && s.start_date > prev.start)) out.set(s.agent_id, { office: s.office_id, start: s.start_date, open });
  }
  return new Map([...out].map(([k, v]) => [k, m.officeById.get(v.office)?.cabang_name ?? ""]));
}

export type StageRow = {
  id: string; import_id: string; row_no: number; month: number; induk_raw: string | null; cabang_raw: string; ma_raw: string;
  office_key: string; ma_key: string; bayar_via: string | null; plafond_kpr: number | string | null; res_comm: string | null;
  solo_cobroke: string | null; psr: string | null; lsl: string | null; nilai_transaksi: number | string; komisi_gross: number | string;
  alamat: string | null; kantor_cobroke: string | null; ma_cobroke: string | null; file_amounts: FileAmounts; line_id: string | null;
};
const STAGE_SELECT = "id,import_id,row_no,month,induk_raw,cabang_raw,ma_raw,office_key,ma_key,bayar_via,plafond_kpr,res_comm,solo_cobroke,psr,lsl,nilai_transaksi,komisi_gross,alamat,kantor_cobroke,ma_cobroke,file_amounts,line_id";

export type StageFilter = { importIds?: string[]; officeKeys?: string[]; maKey?: string };
export async function loadStage(db: Db, f: StageFilter, select = STAGE_SELECT): Promise<StageRow[]> {
  if ((f.importIds && !f.importIds.length) || (f.officeKeys && !f.officeKeys.length)) return [];
  return all<StageRow>((a, b) => {
    let q = db.from("yearly_import_rows").select(select);
    if (f.importIds) q = q.in("import_id", f.importIds);
    if (f.officeKeys) q = q.in("office_key", f.officeKeys);
    if (f.maKey) q = q.eq("ma_key", f.maKey);
    return q.order("id").range(a, b);
  });
}

// Baris staging untuk disisipkan (id dibuat di sini supaya tidak perlu dibaca balik).
export function stageRowsOf(importId: string, rows: YearRow[]) {
  return rows.map((r) => ({
    id: randomUUID(), import_id: importId, row_no: r.row_no, month: r.month, induk_raw: r.induk_raw || null, cabang_raw: r.cabang_raw, ma_raw: r.ma_raw,
    office_key: officeKey(r.cabang_raw), ma_key: maKey(r.ma_raw), bayar_via: r.bayar_via || null, plafond_kpr: r.plafond_kpr,
    res_comm: r.res_comm || null, solo_cobroke: r.solo_cobroke || null, psr: r.psr || null, lsl: r.lsl || null,
    nilai_transaksi: r.nilai_transaksi, komisi_gross: r.komisi_gross, alamat: r.alamat || null, kantor_cobroke: r.kantor_cobroke || null,
    ma_cobroke: r.ma_cobroke || null, file_amounts: r.file,
  }));
}

export async function insertBatched(db: Db, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).insert(rows.slice(i, i + BATCH));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

// Isi peta otomatis untuk baris yang belum terpetakan: kantor bernama sama persis (dan 360 (MPS)/(TSP) → _360),
// lalu MA yang namanya sama persis dengan satu agen (atau satu agen kantor itu). Peta yang sudah ada tidak diubah.
// db = null: hanya di memori (pratinjau), tidak menulis ke database.
export async function autoMap(db: Db | null, m: Master, rows: Pick<StageRow, "office_key" | "ma_key" | "cabang_raw" | "induk_raw" | "ma_raw">[]): Promise<{ offices: number; agents: number }> {
  const offices: { name_key: string; office_id: string; created_by: string }[] = [];
  for (const r of rows) {
    if (!r.office_key || m.officeMap.has(r.office_key)) continue;
    const auto = matchOffice(r.cabang_raw, m.offices, r.induk_raw ?? "").auto;
    if (auto) {
      offices.push({ name_key: r.office_key, office_id: auto.id, created_by: "auto" });
      m.officeMap.set(r.office_key, { officeId: auto.id, source: "auto" });
    }
  }
  const agents: { office_id: string; name_key: string; agent_id: string; created_by: string }[] = [];
  const tried = new Set<string>();
  for (const r of rows) {
    const officeId = m.officeMap.get(r.office_key)?.officeId;
    if (!officeId || !r.ma_key) continue;
    const k = pairKey(officeId, r.ma_key);
    if (m.agentMap.has(k) || tried.has(k)) continue;
    tried.add(k);
    const agentId = m.index.auto(officeId, r.ma_raw);
    if (agentId) {
      agents.push({ office_id: officeId, name_key: r.ma_key, agent_id: agentId, created_by: "auto" });
      m.agentMap.set(k, { agentId, source: "auto" });
    }
  }
  if (!db) return { offices: offices.length, agents: agents.length };
  for (let i = 0; i < offices.length; i += BATCH) {
    const { error } = await db.from("office_name_map").upsert(offices.slice(i, i + BATCH), { onConflict: "name_key", ignoreDuplicates: true });
    if (error) throw new Error(`office_name_map: ${error.message}`);
  }
  for (let i = 0; i < agents.length; i += BATCH) {
    const { error } = await db.from("agent_name_map").upsert(agents.slice(i, i + BATCH), { onConflict: "office_id,name_key", ignoreDuplicates: true });
    if (error) throw new Error(`agent_name_map: ${error.message}`);
  }
  return { offices: offices.length, agents: agents.length };
}

// Baris staging yang belum lengkap: nama cabang belum jadi kantor, atau pasangan kantor + MA belum punya agen.
export function unresolvedOf(m: Master, rows: Pick<StageRow, "office_key" | "ma_key">[]): { offices: number; pairs: number; rows: number } {
  const offices = new Set<string>(), pairs = new Set<string>();
  let n = 0;
  for (const r of rows) {
    const { office, agentId } = resolveRow(m, r);
    if (!office) offices.add(r.office_key);
    else if (!agentId) pairs.add(pairKey(office.id, r.ma_key));
    else continue;
    n++;
  }
  return { offices: offices.size, pairs: pairs.size, rows: n };
}

export type YearImportRec = { id: string; year: number; source_file: string | null; sheet: string | null };

// Baris commission_lines untuk SEMUA baris staging satu impor (dipakai saat Simpan final). Gagal kalau masih ada
// baris yang kantor/agennya belum jelas, atau periodenya belum ada. Komisi dihitung ulang dengan tarif kantor
// (calcAmounts); angka di file disimpan di original sebagai pembanding. Id baris = id staging.
export function linesOf(m: Master, imp: YearImportRec, rows: StageRow[], periodOf: Map<number, string>): Record<string, unknown>[] {
  return rows.map((r) => {
    const { office, agentId } = resolveRow(m, r);
    const periodId = periodOf.get(r.month);
    if (!office || !agentId || !periodId) throw new Error(`Baris ${r.row_no} (${r.cabang_raw} · ${r.ma_raw}) belum lengkap.`);
    const royaltyRate = Number(office.royalty_rate), ssdfRate = Number(office.ssdf_rate);
    return {
      id: r.id, period_id: periodId, cabang_id: office.id, source: "import", import_batch_id: imp.id,
      tanggal_transaksi: null, bayar_via: r.bayar_via, plafond_kpr: r.plafond_kpr, res_comm: r.res_comm, solo_cobroke: r.solo_cobroke,
      psr: r.psr, lsl: r.lsl, ma_name: r.ma_raw, agent_id: agentId, nilai_transaksi: Number(r.nilai_transaksi) || 0,
      alamat: r.alamat, kantor_cobroke: r.kantor_cobroke, ma_cobroke: r.ma_cobroke, komisi_pct: null,
      royalty_rate: royaltyRate, ssdf_rate: ssdfRate, ...calcAmounts(Number(r.komisi_gross) || 0, royaltyRate, ssdfRate),
      // Bukan "file": kunci itu dibaca halaman Rekon/Upload sebagai nama file upload Excel kantor.
      original: { ...r.file_amounts, row_no: r.row_no, import_file: imp.source_file, sheet: imp.sheet, year: imp.year, office_file: r.cabang_raw, induk_file: r.induk_raw },
    };
  });
}

// Tarik semua baris laporan satu impor (Buka kembali / gagal di tengah Simpan).
export async function deleteImportLines(db: Db, importId: string): Promise<void> {
  const { error } = await db.from("commission_lines").delete().eq("import_batch_id", importId);
  if (error) throw new Error(`commission_lines: ${error.message}`);
}

export const PERIOD_OWNER = "impor_tahunan"; // locked_by untuk periode yang dibuat Impor Data Tahunan

// Hapus periode buatan impor tahunan yang sudah kosong (tidak dipakai tabel mana pun). Yang masih dipakai dibiarkan.
export async function dropEmptyImportPeriods(db: Db, year: number): Promise<void> {
  const { data } = await db.from("periods").select("id").eq("year", year).eq("locked_by", PERIOD_OWNER).eq("status", "locked");
  for (const p of data ?? []) {
    const { count } = await db.from("commission_lines").select("id", { count: "exact", head: true }).eq("period_id", p.id as string);
    if (count) continue;
    await db.from("periods").delete().eq("id", p.id as string); // masih dipakai tabel lain (FK) → gagal = dibiarkan
  }
}

// Kunci nama cabang yang terpetakan ke satu kantor (untuk memuat baris staging pasangan kantor + MA).
export const officeKeysOf = (m: Master, officeId: string) => [...m.officeMap].filter(([, v]) => v.officeId === officeId).map(([k]) => k);
