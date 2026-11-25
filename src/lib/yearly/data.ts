import "server-only";

import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { calcAmounts } from "@/lib/closing/calc";
import { inferKategori, matchOffice } from "@/lib/yearly/match";
import { currentOffice, loadMaster, loadStage, pairKey, resolveRow, type Master, type StageRow } from "@/lib/yearly/publish";

// Loader halaman Impor Data Tahunan & Verifikasi (server-only, tanpa cache: datanya berubah setiap verifikasi).
// Status baris dihitung dari peta nama saat ini (bukan disimpan): lengkap = kantor dan MA sudah terverifikasi.

const TOLERANCE = 2; // selisih royalti/SSDF file vs hitung ulang yang masih dianggap pembulatan (Rp)
const LIGHT = "id,import_id,row_no,month,cabang_raw,induk_raw,ma_raw,office_key,ma_key,komisi_gross,file_amounts";

export type Sum = { rows: number; gc: number };
export type YearImportStatus = "draft" | "final";
export type YearImportSummary = {
  id: string; year: number; sourceFile: string | null; sheet: string | null; createdAt: string; updatedAt: string; createdBy: string | null;
  // draft = belum ada baris di laporan (verifikasi berjalan); final = semua baris sudah masuk Data/GC/Top MA/Laporan.
  status: YearImportStatus; finalizedAt: string | null;
  totalRows: number; // baris data terbaca (tidak termasuk yang dilewati)
  skippedRows: number; // MA kosong / Total Komisi ≤ 0
  errors: string[];
  ready: Sum; // baris yang kantor DAN MA-nya sudah terverifikasi
  pending: Sum; // baris yang kantor atau MA-nya belum terverifikasi (Simpan diblokir selama > 0)
  total: Sum;
  otherLines: number; // baris lain (Genius/Excel/skrip) di periode tahun ini: risiko dobel, Simpan perlu konfirmasi
  unresolvedOffices: number; // nama cabang di file yang belum terhubung ke kantor
  unresolvedPairs: number; // pasangan kantor + nama MA yang belum punya Agent ID
  recalcDiffs: number; // baris dengan royalti/SSDF di file beda > Rp2 dari hitung ulang tarif kantor (peringatan)
};

export type OfficeSuggestion = { officeId: string; cabangName: string; induk: string; status: string; kategori: string };
export type OfficeIssue = {
  nameKey: string; cabangRaw: string; indukRaw: string; rows: number; gc: number; maNames: number;
  suggestions: OfficeSuggestion[];
  inferredKategori: "3.5" | "9" | null; // dari rasio royalti/komisi di file, untuk kantor baru (historis)
};
export type ResolvedOffice = Omit<OfficeIssue, "suggestions"> & { officeId: string; cabangName: string; induk: string; status: string; source: "auto" | "hq" };

export type AgentSuggestion = { agentId: string; code: string; name: string; fullName: string | null; office: string | null; score: number; local: boolean; role: string; status: string };
export type AgentPair = {
  officeId: string; officeName: string; induk: string; maRaw: string; nameKey: string; rows: number; gc: number; months: number[];
  suggestions: AgentSuggestion[];
  agentId?: string; agentCode?: string; agentName?: string;
  source: "auto" | "hq"; // pasangan belum terverifikasi: "hq" (perlu dipilih HQ)
};
export type AgentOption = { id: string; code: string; name: string; fullName: string | null; role: string; status: string; office: string | null };
export type Verification = {
  year: number; importId: string | null; status: YearImportStatus | null;
  offices: OfficeIssue[]; resolvedOffices: ResolvedOffice[];
  pairs: AgentPair[]; resolvedPairs: AgentPair[];
  agents: AgentOption[]; // semua agen master (pencarian manual)
  officeOptions: OfficeSuggestion[]; // semua kantor master (pilih manual)
};

const num = (v: number | string | null | undefined) => Number(v) || 0;

type Db = ReturnType<typeof supabaseClosingAdmin>;
// Baris lain (bukan impor tahunan ini) di periode tahun itu: Genius/Excel/manual/skrip impor 2026.
export async function otherLinesOf(db: Db, year: number, importId: string | null): Promise<number> {
  const { data: periods, error } = await db.from("periods").select("id").eq("year", year);
  if (error) throw new Error(error.message);
  if (!periods?.length) return 0;
  let q = db.from("commission_lines").select("id", { count: "exact", head: true }).in("period_id", periods.map((p) => p.id as string)).is("batal_at", null);
  q = importId ? q.or(`import_batch_id.is.null,import_batch_id.neq.${importId}`) : q.is("import_batch_id", null);
  const { count, error: cErr } = await q;
  if (cErr) throw new Error(cErr.message);
  return count ?? 0;
}
const add = (s: Sum, gc: number): Sum => ({ rows: s.rows + 1, gc: s.gc + gc });

function recalcDiff(m: Master, r: StageRow): boolean {
  const { office } = resolveRow(m, r);
  if (!office) return false;
  const c = calcAmounts(num(r.komisi_gross), num(office.royalty_rate), num(office.ssdf_rate));
  const f = r.file_amounts ?? {};
  return (f.royalti != null && Math.abs(f.royalti - c.royalti) > TOLERANCE) || (f.ssdf != null && Math.abs(f.ssdf - c.ssdf) > TOLERANCE);
}

export async function loadYearImports(): Promise<YearImportSummary[]> {
  const db = supabaseClosingAdmin();
  const { data, error } = await db.from("yearly_imports").select("id,year,source_file,sheet,total_rows,skipped_rows,errors,created_by,created_at,updated_at,status,finalized_at").order("year", { ascending: false });
  if (error) throw new Error(`Gagal baca impor tahunan: ${error.message}`);
  if (!data?.length) return [];
  const [m, rows] = await Promise.all([loadMaster(db), loadStage(db, { importIds: data.map((x) => x.id as string) }, LIGHT)]);
  const byImport = new Map<string, StageRow[]>();
  for (const r of rows) {
    const list = byImport.get(r.import_id);
    if (list) list.push(r); else byImport.set(r.import_id, [r]);
  }
  const others = await Promise.all(data.map((x) => otherLinesOf(db, x.year as number, x.id as string)));
  return data.map((x, i) => {
    const list = byImport.get(x.id as string) ?? [];
    let ready: Sum = { rows: 0, gc: 0 }, pending: Sum = { rows: 0, gc: 0 }, diffs = 0;
    const offices = new Set<string>(), pairs = new Set<string>();
    for (const r of list) {
      const gc = num(r.komisi_gross);
      const { office, agentId } = resolveRow(m, r);
      if (!office) offices.add(r.office_key);
      else if (!agentId) pairs.add(pairKey(office.id, r.ma_key));
      if (office && agentId) ready = add(ready, gc); else pending = add(pending, gc);
      if (recalcDiff(m, r)) diffs++;
    }
    return {
      id: x.id, year: x.year, sourceFile: x.source_file, sheet: x.sheet, createdAt: x.created_at, updatedAt: x.updated_at, createdBy: x.created_by,
      status: (x.status as YearImportStatus) ?? "draft", finalizedAt: x.finalized_at ?? null,
      totalRows: x.total_rows, skippedRows: x.skipped_rows, errors: (x.errors as string[] | null) ?? [],
      ready, pending, total: { rows: ready.rows + pending.rows, gc: ready.gc + pending.gc }, otherLines: others[i],
      unresolvedOffices: offices.size, unresolvedPairs: pairs.size, recalcDiffs: diffs,
    };
  });
}

// Bahan halaman Verifikasi satu tahun: nama cabang yang belum jadi kantor, dan pasangan kantor + MA yang belum punya agen.
export async function loadVerification(year: number): Promise<Verification> {
  const db = supabaseClosingAdmin();
  const { data: imp, error } = await db.from("yearly_imports").select("id,status").eq("year", year).maybeSingle();
  if (error) throw new Error(`Gagal baca impor tahunan: ${error.message}`);
  const m = await loadMaster(db);
  const cur = currentOffice(m);
  const officeOptions: OfficeSuggestion[] = m.offices
    .map((o) => ({ officeId: o.id, cabangName: o.cabang_name, induk: o.induk_name, status: o.status, kategori: o.kategori }))
    .sort((a, b) => a.cabangName.localeCompare(b.cabangName));
  const agents: AgentOption[] = m.agents
    .map((a) => ({ id: a.id, code: a.employee_code, name: a.name, fullName: a.full_name, role: a.role, status: a.status, office: cur.get(a.id) || null }))
    .sort((a, b) => (a.fullName ?? a.name).localeCompare(b.fullName ?? b.name));
  const empty: Verification = { year, importId: null, status: null, offices: [], resolvedOffices: [], pairs: [], resolvedPairs: [], agents, officeOptions };
  if (!imp) return empty;
  const rows = await loadStage(db, { importIds: [imp.id as string] }, LIGHT);

  // Kantor: dikelompokkan per nama cabang ternormalisasi.
  type OfficeAcc = { key: string; cabang: string; induk: string; rows: StageRow[]; gc: number; ma: Set<string> };
  const byOffice = new Map<string, OfficeAcc>();
  type PairAcc = { officeId: string; key: string; ma: string; rows: number; gc: number; months: Set<number> };
  const byPair = new Map<string, PairAcc>();
  for (const r of rows) {
    const gc = num(r.komisi_gross);
    const o = byOffice.get(r.office_key) ?? { key: r.office_key, cabang: r.cabang_raw, induk: r.induk_raw ?? "", rows: [], gc: 0, ma: new Set<string>() };
    o.rows.push(r); o.gc += gc; o.ma.add(r.ma_key);
    byOffice.set(r.office_key, o);
    const { office } = resolveRow(m, r);
    if (!office) continue;
    const k = pairKey(office.id, r.ma_key);
    const p = byPair.get(k) ?? { officeId: office.id, key: r.ma_key, ma: r.ma_raw, rows: 0, gc: 0, months: new Set<number>() };
    p.rows++; p.gc += gc; p.months.add(r.month);
    byPair.set(k, p);
  }

  const offices: OfficeIssue[] = [], resolvedOffices: ResolvedOffice[] = [];
  const toSuggestion = (o: Master["offices"][number]): OfficeSuggestion => ({ officeId: o.id, cabangName: o.cabang_name, induk: o.induk_name, status: o.status, kategori: o.kategori });
  for (const o of byOffice.values()) {
    const base = { nameKey: o.key, cabangRaw: o.cabang, indukRaw: o.induk, rows: o.rows.length, gc: o.gc, maNames: o.ma.size, inferredKategori: inferKategori(o.rows.map((r) => ({ komisi_gross: num(r.komisi_gross), file: r.file_amounts ?? {} }))) };
    const mapped = m.officeMap.get(o.key);
    const office = mapped ? m.officeById.get(mapped.officeId) : undefined;
    if (office && mapped) resolvedOffices.push({ ...base, officeId: office.id, cabangName: office.cabang_name, induk: office.induk_name, status: office.status, source: mapped.source });
    else offices.push({ ...base, suggestions: matchOffice(o.cabang, m.offices, o.induk).suggestions.map(toSuggestion) });
  }

  const pairs: AgentPair[] = [], resolvedPairs: AgentPair[] = [];
  for (const p of byPair.values()) {
    const office = m.officeById.get(p.officeId)!;
    const base = { officeId: office.id, officeName: office.cabang_name, induk: office.induk_name, maRaw: p.ma, nameKey: p.key, rows: p.rows, gc: p.gc, months: [...p.months].sort((a, b) => a - b) };
    const mapped = m.agentMap.get(pairKey(p.officeId, p.key));
    const agent = mapped ? m.agentById.get(mapped.agentId) : undefined;
    if (agent && mapped) {
      resolvedPairs.push({ ...base, suggestions: [], agentId: agent.id, agentCode: agent.employee_code, agentName: agent.full_name ?? agent.name, source: mapped.source });
      continue;
    }
    const suggestions = m.index.suggest(p.officeId, p.ma).flatMap((s) => {
      const a = m.agentById.get(s.id);
      return a ? [{ agentId: a.id, code: a.employee_code, name: a.name, fullName: a.full_name, office: cur.get(a.id) || null, score: Math.round(s.score * 1000) / 1000, local: s.local, role: a.role, status: a.status }] : [];
    });
    pairs.push({ ...base, suggestions, source: "hq" });
  }
  const byGc = <T extends { gc: number }>(a: T, b: T) => b.gc - a.gc;
  return { ...empty, importId: imp.id as string, status: (imp.status as YearImportStatus) ?? "draft", offices: offices.sort(byGc), resolvedOffices: resolvedOffices.sort(byGc), pairs: pairs.sort(byGc), resolvedPairs: resolvedPairs.sort(byGc) };
}
