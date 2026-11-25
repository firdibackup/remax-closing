"use server";

import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit, str } from "@/lib/closing/audit";
import { refreshAll } from "@/lib/closing/cache";
import { KATEGORI_RATES } from "@/lib/closing/calc";
import { searchEmployees } from "@/lib/genius/client";
import type { GeniusEmployeeHit } from "@/lib/genius/types";
import { inferKategori } from "@/lib/yearly/match";
import { parseYearSheet, type YearSheet } from "@/lib/yearly/parse";
import { readYearWorkbook } from "@/lib/yearly/read";
import { loadVerification, otherLinesOf as otherLinesOfDb } from "@/lib/yearly/data";
import {
  autoMap, deleteImportLines, dropEmptyImportPeriods, insertBatched, linesOf, loadMaster, loadStage, officeKeysOf, pairKey,
  stageRowsOf, unresolvedOf, BATCH, PERIOD_OWNER,
} from "@/lib/yearly/publish";

// Impor Data Tahunan + Verifikasi, tiga langkah:
//   1. Upload Master Data satu tahun → semua baris masuk DRAFT (staging); nama kantor & MA yang pasti cocok dipetakan otomatis.
//   2. Verifikasi: HQ menghubungkan nama cabang → kantor dan nama MA → Agent ID. Belum ada yang masuk laporan.
//   3. Simpan ke laporan (finalizeYearImport): hanya bisa kalau semua kantor & MA terverifikasi; semua baris masuk sekaligus.
// Komisi dihitung ulang dengan tarif kantor; angka di file disimpan di original sebagai pembanding.

const MAX_BYTES = 10 * 1024 * 1024; // butuh experimental.serverActions.bodySizeLimit ≥ 11mb di next.config.ts
const UUID = /^[0-9a-f-]{36}$/i;
const ACTOR = "superadmin";
const DEFAULT_MIN_SCORE = 0.9;

export type YearlyResult = { ok: boolean; message: string; errors?: string[] } | null;

export type YearPreview = {
  ok: boolean; message: string; errors?: string[];
  fileName?: string; sheet?: string; sheets?: string[]; year?: number | null;
  rows?: number; // baris data terbaca
  skipped?: number; // dilewati: MA kosong / Total Komisi ≤ 0
  months?: { month: number; rows: number; gc: number }[];
  totals?: { gc: number; nilai: number };
  offices?: { names: number; matched: number; rowsMatched: number; unmatched: { cabangRaw: string; indukRaw: string; rows: number }[] };
  agents?: { pairs: number; matched: number; rowsMatched: number }; // pasangan kantor + nama MA (yang kantornya sudah cocok)
  publishable?: number; // baris yang kantor + MA-nya langsung cocok otomatis (sisanya perlu diverifikasi)
  exists?: { createdAt: string; sourceFile: string | null; rows: number; status: "draft" | "final" } | null; // tahun ini sudah pernah diimpor
  otherLines?: number; // baris lain (Genius/Excel/impor lama) yang sudah ada di periode tahun ini, risiko dobel
} | null;

export type YearCommit = YearlyResult & {
  year?: number; importId?: string; rows?: number; skipped?: number;
  ready?: number; pending?: number; // baris lengkap / belum lengkap (kantor atau MA belum terverifikasi)
  unresolvedOffices?: number; unresolvedPairs?: number; autoOffices?: number; autoAgents?: number;
} | null;

export type AgentCreateResult = YearlyResult & { agentId?: string } | null;

type Loaded = { fileName: string; sheet: string; sheets: string[]; parsed: YearSheet; year: number };

// Baca file dari form: file (.xlsx), sheet (opsional), year (opsional; wajib kalau nama sheet bukan tahun).
async function loadFile(fd: FormData): Promise<Loaded | { error: string; errors?: string[] }> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Pilih file Master Data (.xlsx)." };
  if (!/\.xlsx$/i.test(file.name)) return { error: "File harus .xlsx. File .xls lama: buka di Excel lalu Save As .xlsx." };
  if (file.size > MAX_BYTES) return { error: "File lebih dari 10 MB." };
  const wb = await readYearWorkbook(await file.arrayBuffer(), str(fd, "sheet") || undefined);
  if (typeof wb === "string") return { error: wb };
  const parsed = parseYearSheet(wb.sheet, wb.rows);
  if (!parsed.rows.length) return { error: `Tidak ada baris yang bisa dibaca dari sheet “${wb.sheet}”.`, errors: parsed.errors };
  const pick = str(fd, "year");
  const picked = /^\d{4}$/.test(pick) ? Number(pick) : null;
  if (picked && parsed.year && picked !== parsed.year) return { error: `Tahun dipilih ${picked}, tetapi sheet bernama “${wb.sheet}”.` };
  const year = parsed.year ?? picked;
  if (!year || year < 2000 || year > 2100) return { error: `Nama sheet “${wb.sheet}” bukan tahun. Pilih tahunnya.`, errors: parsed.errors };
  return { fileName: file.name, sheet: wb.sheet, sheets: wb.sheets, parsed: { ...parsed, errors: parsed.errors.filter((e) => !/bukan tahun/.test(e)) }, year };
}

async function existingImport(year: number) {
  const { data, error } = await supabaseClosingAdmin().from("yearly_imports").select("id,created_at,source_file,sheet,total_rows,status").eq("year", year).maybeSingle();
  if (error) throw new Error(`Gagal baca impor tahunan: ${error.message}`);
  return data as { id: string; created_at: string; source_file: string | null; sheet: string | null; total_rows: number; status: "draft" | "final" } | null;
}

const otherLinesOf = (year: number, importId: string | null) => otherLinesOfDb(supabaseClosingAdmin(), year, importId);

// Pratinjau tanpa menyimpan: ringkasan baca file + berapa kantor/MA yang langsung cocok.
export async function previewYearFile(_: YearPreview, fd: FormData): Promise<YearPreview> {
  const f = await loadFile(fd);
  if ("error" in f) return { ok: false, message: f.error, errors: f.errors };
  const { parsed, year } = f;
  const m = await loadMaster();
  const staged = stageRowsOf("preview", parsed.rows);
  await autoMap(null, m, staged); // hanya di memori

  const months = new Map<number, { rows: number; gc: number }>();
  const officeNames = new Map<string, { cabangRaw: string; indukRaw: string; rows: number; matched: boolean }>();
  const pairs = new Map<string, { rows: number; matched: boolean }>();
  let gc = 0, nilai = 0, publishable = 0;
  for (const r of staged) {
    const k = r.komisi_gross;
    gc += k; nilai += r.nilai_transaksi;
    const mo = months.get(r.month) ?? { rows: 0, gc: 0 };
    months.set(r.month, { rows: mo.rows + 1, gc: mo.gc + k });
    const officeId = m.officeMap.get(r.office_key)?.officeId ?? null;
    const o = officeNames.get(r.office_key) ?? { cabangRaw: r.cabang_raw, indukRaw: r.induk_raw ?? "", rows: 0, matched: !!officeId };
    o.rows++;
    officeNames.set(r.office_key, o);
    if (!officeId) continue;
    const pk = pairKey(officeId, r.ma_key);
    const matched = m.agentMap.has(pk);
    const p = pairs.get(pk) ?? { rows: 0, matched };
    p.rows++;
    pairs.set(pk, p);
    if (matched) publishable++;
  }
  const oList = [...officeNames.values()], pList = [...pairs.values()];
  const exists = await existingImport(year);
  const otherLines = await otherLinesOf(year, exists?.id ?? null);
  const issues = [...parsed.errors];
  if (otherLines) issues.unshift(`Periode ${year} sudah punya ${otherLines} baris dari sumber lain (Genius/Excel/impor lama). Kalau isinya sama dengan file ini, laporan akan dobel.`);
  return {
    ok: true,
    message: `${parsed.rows.length} baris ${year} terbaca dari ${f.fileName} (sheet “${f.sheet}”), ${parsed.skipped} baris dilewati (MA kosong / komisi 0).`,
    errors: issues.length ? issues : undefined,
    fileName: f.fileName, sheet: f.sheet, sheets: f.sheets, year, rows: parsed.rows.length, skipped: parsed.skipped,
    months: [...months].map(([month, v]) => ({ month, ...v })).sort((a, b) => a.month - b.month),
    totals: { gc, nilai },
    offices: {
      names: oList.length, matched: oList.filter((o) => o.matched).length, rowsMatched: oList.filter((o) => o.matched).reduce((a, o) => a + o.rows, 0),
      unmatched: oList.filter((o) => !o.matched).map(({ cabangRaw, indukRaw, rows }) => ({ cabangRaw, indukRaw, rows })).sort((a, b) => b.rows - a.rows),
    },
    agents: { pairs: pList.length, matched: pList.filter((p) => p.matched).length, rowsMatched: pList.filter((p) => p.matched).reduce((a, p) => a + p.rows, 0) },
    publishable,
    exists: exists ? { createdAt: exists.created_at, sourceFile: exists.source_file, rows: exists.total_rows, status: exists.status } : null,
    otherLines,
  };
}

// Simpan file sebagai DRAFT (menggantikan impor tahun yang sama, wajib confirm_replace=1). Belum ada baris yang
// masuk laporan: baris hanya di staging, peta nama yang pasti cocok diisi otomatis, sisanya diverifikasi di
// halaman Verifikasi. Laporan baru terisi setelah Simpan final (finalizeYearImport).
export async function commitYearImport(_: YearCommit, fd: FormData): Promise<YearCommit> {
  const f = await loadFile(fd);
  if ("error" in f) return { ok: false, message: f.error, errors: f.errors };
  const { parsed, year } = f;
  const db = supabaseClosingAdmin();
  const exists = await existingImport(year);
  if (exists && str(fd, "confirm_replace") !== "1") return { ok: false, message: `Data ${year} sudah pernah diimpor (${exists.source_file ?? "file"}). Konfirmasi dulu untuk menggantinya.` };

  // Ganti: staging (dan baris laporan kalau impor lama sudah final) ikut terhapus lewat cascade.
  if (exists) {
    const { error } = await db.from("yearly_imports").delete().eq("id", exists.id);
    if (error) return { ok: false, message: `Gagal menghapus impor ${year} sebelumnya: ${error.message}` };
    if (exists.status === "final") await dropEmptyImportPeriods(db, year);
  }
  const { data: imp, error: iErr } = await db.from("yearly_imports").insert({
    year, source_file: f.fileName, sheet: f.sheet, total_rows: parsed.rows.length, skipped_rows: parsed.skipped, errors: parsed.errors, created_by: ACTOR, status: "draft",
  }).select("id").single();
  if (iErr) return { ok: false, message: `Gagal menyimpan impor: ${iErr.message}` };
  const importId = imp.id as string;

  try {
    const staged = stageRowsOf(importId, parsed.rows);
    await insertBatched(db, "yearly_import_rows", staged);
    const m = await loadMaster(db);
    const auto = await autoMap(db, m, staged);
    const left = unresolvedOf(m, staged);
    await audit(exists ? "ganti_impor_tahunan" : "impor_tahunan", "yearly_imports", importId, {
      year, file: f.fileName, sheet: f.sheet, rows: parsed.rows.length, skipped: parsed.skipped, status: "draft",
      auto_offices: auto.offices, auto_agents: auto.agents, kantor_belum: left.offices, ma_belum: left.pairs, replaced: exists?.id ?? null,
    });
    refreshAll();
    return {
      ok: true,
      message: left.rows
        ? `${parsed.rows.length} baris ${year} masuk draft. Belum masuk laporan: verifikasi dulu ${left.offices} kantor dan ${left.pairs} MA, lalu Simpan ke laporan.`
        : `${parsed.rows.length} baris ${year} masuk draft dan semuanya sudah cocok. Periksa di Verifikasi, lalu Simpan ke laporan.`,
      errors: parsed.errors.length ? parsed.errors : undefined,
      year, importId, rows: parsed.rows.length, skipped: parsed.skipped, ready: parsed.rows.length - left.rows, pending: left.rows,
      unresolvedOffices: left.offices, unresolvedPairs: left.pairs, autoOffices: auto.offices, autoAgents: auto.agents,
    };
  } catch (e) {
    await db.from("yearly_imports").delete().eq("id", importId);
    refreshAll();
    return { ok: false, message: `Impor ${year} gagal disimpan: ${(e as Error).message}. Upload ulang file yang sama.` };
  }
}

// Simpan final: hanya kalau SEMUA kantor dan MA sudah terverifikasi. 12 periode tahun itu dibuat terkunci
// (periode yang sudah ada tidak diubah), lalu semua baris masuk commission_lines sekaligus.
export async function finalizeYearImport(_: YearlyResult, fd: FormData): Promise<YearlyResult> {
  const year = Number(str(fd, "year"));
  if (!Number.isInteger(year)) return { ok: false, message: "Tahun tidak valid." };
  const db = supabaseClosingAdmin();
  const imp = await existingImport(year);
  if (!imp) return { ok: false, message: `Belum ada impor ${year}.` };
  if (imp.status === "final") return { ok: false, message: `Data ${year} sudah tersimpan di laporan.` };
  const [m, rows] = await Promise.all([loadMaster(db), loadStage(db, { importIds: [imp.id] })]);
  if (!rows.length) return { ok: false, message: `Impor ${year} tidak punya baris.` };
  const left = unresolvedOf(m, rows);
  if (left.rows) return { ok: false, message: `Belum bisa disimpan: ${left.offices} kantor dan ${left.pairs} MA belum terverifikasi (${left.rows} baris).` };
  const otherLines = await otherLinesOf(year, imp.id);
  if (otherLines && str(fd, "confirm_double") !== "1") return { ok: false, message: `Periode ${year} sudah punya ${otherLines} baris dari sumber lain. Kalau isinya sama dengan file ini, laporan akan dobel. Centang konfirmasi kalau memang ingin tetap disimpan.` };

  const now = new Date().toISOString();
  const periods = Array.from({ length: 12 }, (_, i) => ({ year, month: i + 1, status: "locked", locked_by: PERIOD_OWNER, locked_at: now }));
  const { error: pErr } = await db.from("periods").upsert(periods, { onConflict: "year,month", ignoreDuplicates: true });
  if (pErr) return { ok: false, message: `Gagal menyiapkan periode ${year}: ${pErr.message}` };
  const { data: ps, error: rErr } = await db.from("periods").select("id,month").eq("year", year);
  if (rErr) return { ok: false, message: `Gagal baca periode ${year}: ${rErr.message}` };
  const periodOf = new Map((ps ?? []).map((p) => [p.month as number, p.id as string]));

  try {
    const lines = linesOf(m, { id: imp.id, year, source_file: imp.source_file, sheet: imp.sheet }, rows, periodOf);
    for (let i = 0; i < lines.length; i += BATCH) {
      const { error } = await db.from("commission_lines").upsert(lines.slice(i, i + BATCH), { onConflict: "id" });
      if (error) throw new Error(error.message);
    }
    const { error } = await db.from("yearly_imports").update({ status: "final", finalized_at: now, finalized_by: ACTOR, updated_at: now }).eq("id", imp.id);
    if (error) throw new Error(error.message);
    const gc = rows.reduce((a, r) => a + (Number(r.komisi_gross) || 0), 0);
    await audit("simpan_impor_tahunan", "yearly_imports", imp.id, { year, file: imp.source_file, rows: lines.length, gc, other_lines: otherLines });
    refreshAll();
    return { ok: true, message: `${lines.length} baris ${year} tersimpan dan sekarang tampil di Data, GC, Top MA, dan Laporan ${year}.` };
  } catch (e) {
    // Jangan biarkan tahun setengah masuk laporan.
    await deleteImportLines(db, imp.id).catch(() => {});
    await dropEmptyImportPeriods(db, year).catch(() => {});
    refreshAll();
    return { ok: false, message: `Gagal menyimpan ke laporan: ${(e as Error).message}. Tidak ada baris yang masuk; coba lagi.` };
  }
}

// Buka kembali impor final: baris laporannya ditarik, impor kembali draft supaya verifikasinya bisa diubah.
export async function reopenYearImport(_: YearlyResult, fd: FormData): Promise<YearlyResult> {
  const year = Number(str(fd, "year"));
  if (!Number.isInteger(year)) return { ok: false, message: "Tahun tidak valid." };
  const db = supabaseClosingAdmin();
  const imp = await existingImport(year);
  if (!imp) return { ok: false, message: `Belum ada impor ${year}.` };
  if (imp.status !== "final") return { ok: false, message: `Data ${year} masih draft.` };
  const { count } = await db.from("commission_lines").select("id", { count: "exact", head: true }).eq("import_batch_id", imp.id);
  try {
    await deleteImportLines(db, imp.id);
  } catch (e) {
    return { ok: false, message: `Gagal menarik baris laporan: ${(e as Error).message}` };
  }
  const { error } = await db.from("yearly_imports").update({ status: "draft", finalized_at: null, finalized_by: null, updated_at: new Date().toISOString() }).eq("id", imp.id);
  if (error) return { ok: false, message: `Gagal mengubah status: ${error.message}` };
  await dropEmptyImportPeriods(db, year);
  await audit("buka_impor_tahunan", "yearly_imports", imp.id, { year, lines: count ?? 0 });
  refreshAll();
  return { ok: true, message: `Data ${year} kembali draft: ${count ?? 0} baris ditarik dari laporan. Simpan lagi setelah verifikasi selesai.` };
}

export async function deleteYearImport(_: YearlyResult, fd: FormData): Promise<YearlyResult> {
  const year = Number(str(fd, "year"));
  if (!Number.isInteger(year)) return { ok: false, message: "Tahun tidak valid." };
  const db = supabaseClosingAdmin();
  const exists = await existingImport(year);
  if (!exists) return { ok: false, message: `Belum ada impor ${year}.` };
  const { count } = await db.from("commission_lines").select("id", { count: "exact", head: true }).eq("import_batch_id", exists.id);
  const { error } = await db.from("yearly_imports").delete().eq("id", exists.id);
  if (error) return { ok: false, message: `Gagal menghapus: ${error.message}` };
  await dropEmptyImportPeriods(db, year);
  await audit("hapus_impor_tahunan", "yearly_imports", exists.id, { year, file: exists.source_file, rows: exists.total_rows, status: exists.status, lines: count ?? 0 });
  refreshAll();
  return { ok: true, message: count ? `Impor ${year} dihapus beserta ${count} baris laporan.` : `Draft impor ${year} dihapus.` };
}

// Peta nama dipakai ulang lintas tahun. Peta yang sudah dipakai impor FINAL tidak boleh diubah dari sini,
// karena baris laporannya sudah terbit (buka kembali impor itu dulu).
async function finalUse(db: ReturnType<typeof supabaseClosingAdmin>, f: { officeKeys: string[]; maKey?: string }): Promise<number | null> {
  const { data } = await db.from("yearly_imports").select("id,year").eq("status", "final");
  if (!data?.length || !f.officeKeys.length) return null;
  for (const y of data) {
    let q = db.from("yearly_import_rows").select("id", { count: "exact", head: true }).eq("import_id", y.id as string).in("office_key", f.officeKeys);
    if (f.maKey) q = q.eq("ma_key", f.maKey);
    const { count } = await q;
    if (count) return y.year as number;
  }
  return null;
}

// Nama cabang di file → kantor: office_id (kantor yang ada), atau kantor baru historis (mode=new: cabang_name,
// induk_name, kategori [default dari rasio royalti di file], status aktif|tutup [default tutup], office_code
// [wajib kalau aktif]).
// Hanya menyimpan peta nama; baris laporan baru dibuat saat Simpan final.
export async function resolveOffice(_: YearlyResult, fd: FormData): Promise<YearlyResult> {
  const nameKey = str(fd, "name_key");
  if (!nameKey) return { ok: false, message: "Nama kantor tidak valid." };
  const db = supabaseClosingAdmin();
  const rows = await loadStage(db, { officeKeys: [nameKey] });
  if (!rows.length) return { ok: false, message: "Nama kantor ini tidak ada di data impor." };
  const usedYear = await finalUse(db, { officeKeys: [nameKey] });
  if (usedYear) return { ok: false, message: `Nama “${rows[0].cabang_raw}” sudah dipakai di laporan ${usedYear}. Buka kembali impor ${usedYear} dulu kalau ingin mengubahnya.` };

  let officeId = str(fd, "office_id"), created: Record<string, unknown> | null = null;
  if (str(fd, "mode") === "new") {
    const inferred = inferKategori(rows.map((r) => ({ komisi_gross: Number(r.komisi_gross) || 0, file: r.file_amounts ?? {} })));
    const kategori = (str(fd, "kategori") || inferred || "") as keyof typeof KATEGORI_RATES;
    if (!KATEGORI_RATES[kategori]) return { ok: false, message: "Pilih kategori tarif 3,5% atau 9% (tidak bisa ditebak dari file)." };
    // Status: tutup (kantor lama, hanya untuk data historis) atau aktif (kantor baru yang masih berjalan).
    const status = str(fd, "status") || "tutup";
    if (!["aktif", "tutup"].includes(status)) return { ok: false, message: "Status kantor tidak dikenal." };
    const officeCode = str(fd, "office_code").toUpperCase();
    if (status === "aktif" && !officeCode) return { ok: false, message: "Kantor aktif wajib punya Office ID (dipakai untuk tarik data Genius)." };
    if (officeCode) {
      const { data: dup } = await db.from("offices").select("cabang_name").eq("office_code", officeCode).maybeSingle();
      if (dup) return { ok: false, message: `Office ID ${officeCode} sudah dipakai ${dup.cabang_name}. Pilih kantor itu.` };
    }
    const row = {
      office_code: officeCode,
      cabang_name: str(fd, "cabang_name") || rows[0].cabang_raw,
      induk_name: (str(fd, "induk_name") || rows[0].induk_raw || rows[0].cabang_raw).toUpperCase(),
      kategori, royalty_rate: KATEGORI_RATES[kategori][0], ssdf_rate: KATEGORI_RATES[kategori][1], status,
      catatan: status === "tutup" ? "Kantor historis dari Impor Data Tahunan." : "Kantor baru dari Impor Data Tahunan.",
    };
    const { data, error } = await db.from("offices").insert(row).select("id").single();
    if (error) return { ok: false, message: error.code === "23505" ? `Nama cabang “${row.cabang_name}” sudah ada. Pilih kantor itu.` : `Gagal menambah kantor: ${error.message}` };
    officeId = data.id as string;
    created = row;
    await audit("tambah_kantor", "offices", officeId, { ...row, sumber: "impor_tahunan", name_key: nameKey });
  }
  if (!UUID.test(officeId)) return { ok: false, message: "Pilih kantor, atau tambahkan kantor baru." };
  const m = await loadMaster(db);
  const office = m.officeById.get(officeId);
  if (!office) return { ok: false, message: "Kantor tidak ditemukan." };
  const before = m.officeMap.get(nameKey)?.officeId ?? null;
  const { error } = await db.from("office_name_map").upsert({ name_key: nameKey, office_id: officeId, created_by: ACTOR }, { onConflict: "name_key" });
  if (error) return { ok: false, message: `Gagal menyimpan: ${error.message}` };
  m.officeMap.set(nameKey, { officeId, source: "hq" });
  const auto = await autoMap(db, m, rows); // MA kantor ini yang namanya pasti cocok
  const left = unresolvedOf(m, rows);
  await audit("verifikasi_kantor", "office_name_map", nameKey, { cabang_file: rows[0].cabang_raw, office_id: officeId, cabang_name: office.cabang_name, sebelumnya: before, baru: !!created, auto_ma: auto.agents });
  refreshAll();
  return { ok: true, message: `“${rows[0].cabang_raw}” = ${office.cabang_name}${created ? ` (kantor baru, status ${created.status === "aktif" ? "Aktif" : "Tutup"})` : ""}. ${auto.agents} MA langsung cocok${left.pairs ? `, ${left.pairs} MA perlu diverifikasi` : ""}.` };
}

async function mapAgent(officeId: string, nameKey: string, agentId: string, action: string): Promise<YearlyResult> {
  const db = supabaseClosingAdmin();
  const m = await loadMaster(db);
  const office = m.officeById.get(officeId), agent = m.agentById.get(agentId);
  if (!office || !agent) return { ok: false, message: !office ? "Kantor tidak ditemukan." : "Agen tidak ditemukan." };
  const keys = officeKeysOf(m, officeId);
  const rows = await loadStage(db, { officeKeys: keys, maKey: nameKey });
  if (!rows.length) return { ok: false, message: "Nama MA ini tidak ada di data impor kantor tersebut." };
  const before = m.agentMap.get(pairKey(officeId, nameKey))?.agentId ?? null;
  if (before && before !== agentId) {
    const usedYear = await finalUse(db, { officeKeys: keys, maKey: nameKey });
    if (usedYear) return { ok: false, message: `“${rows[0].ma_raw}” sudah dipakai di laporan ${usedYear}. Buka kembali impor ${usedYear} dulu kalau ingin mengubahnya.` };
  }
  const { error } = await db.from("agent_name_map").upsert({ office_id: officeId, name_key: nameKey, agent_id: agentId, created_by: ACTOR }, { onConflict: "office_id,name_key" });
  if (error) return { ok: false, message: `Gagal menyimpan: ${error.message}` };
  await audit(action, "agent_name_map", `${officeId}:${nameKey}`, { ma_file: rows[0].ma_raw, office: office.cabang_name, agent_id: agentId, agent_code: agent.employee_code, sebelumnya: before, rows: rows.length });
  refreshAll();
  return { ok: true, message: `“${rows[0].ma_raw}” di ${office.cabang_name} = ${agent.full_name ?? agent.name} (${agent.employee_code}).` };
}

// Pasangan kantor + nama MA → agen master (hanya peta nama; laporan diisi saat Simpan final).
export async function resolveAgent(_: YearlyResult, fd: FormData): Promise<YearlyResult> {
  const officeId = str(fd, "office_id"), nameKey = str(fd, "name_key"), agentId = str(fd, "agent_id");
  if (!UUID.test(officeId) || !nameKey || !UUID.test(agentId)) return { ok: false, message: "Data tidak valid." };
  return mapAgent(officeId, nameKey, agentId, "verifikasi_ma");
}

// Terima saran teratas untuk semua MA yang belum terverifikasi di satu tahun, kalau skornya ≥ min_score (default 0,9)
// dan tidak seri dengan saran kedua.
export async function acceptSuggestions(_: YearlyResult, fd: FormData): Promise<YearlyResult> {
  const year = Number(str(fd, "year"));
  const minRaw = Number(str(fd, "min_score").replace(",", "."));
  const min = minRaw > 0 && minRaw <= 1 ? minRaw : DEFAULT_MIN_SCORE;
  if (!Number.isInteger(year)) return { ok: false, message: "Tahun tidak valid." };
  const v = await loadVerification(year);
  if (!v.importId) return { ok: false, message: `Belum ada impor ${year}.` };
  if (v.status === "final") return { ok: false, message: `Data ${year} sudah tersimpan. Buka kembali dulu untuk mengubah verifikasi.` };
  const picks = v.pairs.flatMap((p) => {
    const [a, b] = p.suggestions;
    return a && a.score >= min && (!b || b.score < a.score) ? [{ office_id: p.officeId, name_key: p.nameKey, agent_id: a.agentId, created_by: ACTOR, ma: p.maRaw, code: a.code }] : [];
  });
  if (!picks.length) return { ok: true, message: `Tidak ada saran dengan skor ≥ ${min.toLocaleString("id-ID")}.` };
  const db = supabaseClosingAdmin();
  for (let i = 0; i < picks.length; i += BATCH) {
    const { error } = await db.from("agent_name_map").upsert(picks.slice(i, i + BATCH).map(({ office_id, name_key, agent_id, created_by }) => ({ office_id, name_key, agent_id, created_by })), { onConflict: "office_id,name_key" });
    if (error) return { ok: false, message: `Gagal menyimpan: ${error.message}` };
  }
  await audit("verifikasi_ma_massal", "agent_name_map", String(year), { year, min_score: min, pairs: picks.map((p) => `${p.ma} → ${p.code}`) });
  refreshAll();
  return { ok: true, message: `${picks.length} nama MA dicocokkan ke saran teratas.` };
}

// Batalkan verifikasi MA: peta dihapus, pasangannya kembali ke daftar "belum terverifikasi".
// Catatan: kalau nama itu cocok persis dengan satu agen, impor ulang akan memetakannya otomatis lagi.
export async function unresolveAgent(_: YearlyResult, fd: FormData): Promise<YearlyResult> {
  const officeId = str(fd, "office_id"), nameKey = str(fd, "name_key");
  if (!UUID.test(officeId) || !nameKey) return { ok: false, message: "Data tidak valid." };
  const db = supabaseClosingAdmin();
  const m = await loadMaster(db);
  const usedYear = await finalUse(db, { officeKeys: officeKeysOf(m, officeId), maKey: nameKey });
  if (usedYear) return { ok: false, message: `MA ini sudah dipakai di laporan ${usedYear}. Buka kembali impor ${usedYear} dulu kalau ingin mengubahnya.` };
  const { data, error } = await db.from("agent_name_map").delete().eq("office_id", officeId).eq("name_key", nameKey).select("agent_id");
  if (error) return { ok: false, message: `Gagal menghapus: ${error.message}` };
  if (!data?.length) return { ok: false, message: "MA ini belum diverifikasi." };
  await audit("batal_verifikasi_ma", "agent_name_map", `${officeId}:${nameKey}`, { agent_id: data[0].agent_id });
  refreshAll();
  return { ok: true, message: "Verifikasi dibatalkan. MA ini kembali ke daftar yang perlu diverifikasi." };
}

// MA yang tidak ada di master: buat agen baru dengan Agent ID asli (employee_code), status resign (data lama) atau
// aktif (masih bekerja), penugasan di kantor itu (kalau tidak bentrok), lalu cocokkan pasangannya ke agen baru.
export async function createHistoricalAgent(_: AgentCreateResult, fd: FormData): Promise<AgentCreateResult> {
  const officeId = str(fd, "office_id"), nameKey = str(fd, "name_key"), year = Number(str(fd, "year"));
  const code = str(fd, "employee_code").toUpperCase(), name = str(fd, "name"), fullName = str(fd, "full_name") || null;
  const role = str(fd, "role") || "agent_property", status = str(fd, "status") || "resign";
  if (!UUID.test(officeId) || !nameKey || !Number.isInteger(year)) return { ok: false, message: "Data tidak valid." };
  if (!/^[A-Z0-9]{3,20}$/.test(code)) return { ok: false, message: "Agent ID (mis. A24277) wajib diisi, huruf/angka saja." };
  if (!name) return { ok: false, message: "Nama agen wajib diisi." };
  if (!["agent_property", "franchise_owner"].includes(role) || !["aktif", "resign"].includes(status)) return { ok: false, message: "Peran/status tidak dikenal." };
  const db = supabaseClosingAdmin();
  const { data: same, error: sErr } = await db.from("agents").select("id,name,full_name").eq("employee_code", code).maybeSingle();
  if (sErr) return { ok: false, message: `Gagal cek Agent ID: ${sErr.message}` };
  if (same) return { ok: false, agentId: same.id as string, message: `Agent ID ${code} sudah dipakai ${same.full_name ?? same.name}. Pilih agen itu kalau orangnya sama.` };

  const row = { employee_code: code, name, full_name: fullName, sheet_name: fullName ?? name, role, status };
  const { data: ag, error } = await db.from("agents").insert(row).select("id").single();
  if (error) return { ok: false, message: error.code === "23505" ? `Agent ID ${code} sudah dipakai.` : `Gagal menambah agen: ${error.message}` };
  const agentId = ag.id as string;
  // Agen resign: penugasan sepanjang tahun impor saja. Agen aktif (data baru): penugasan berjalan sejak awal tahun itu.
  const { error: aErr } = await db.from("agent_assignments").insert({ agent_id: agentId, office_id: officeId, start_date: `${year}-01-01`, end_date: status === "aktif" ? null : `${year}-12-31`, alasan: "awal", created_by: ACTOR });
  const assignNote = aErr ? (aErr.code === "23P01" ? " Penugasan kantor tidak dibuat (bentrok dengan penugasan lain)." : ` Penugasan kantor gagal: ${aErr.message}.`) : "";
  await audit("tambah_agen", "agents", agentId, { ...row, sumber: "impor_tahunan", office_id: officeId, tahun: year, penugasan: !aErr });
  const res = await mapAgent(officeId, nameKey, agentId, "verifikasi_ma");
  return { ...res, ok: !!res?.ok, agentId, message: `Agen ${code} ditambahkan.${assignNote} ${res?.message ?? ""}`.trim() };
}

export type GeniusAgentHit = GeniusEmployeeHit & { agentId: string | null }; // agentId = sudah ada di master
export type GeniusSearch = { ok: boolean; message: string; results: GeniusAgentHit[] };

// Cari Agent ID di Genius (kode atau satu kata nama). Untuk mengisi form agen historis.
export async function searchGeniusAgents(q: string): Promise<GeniusSearch> {
  const query = String(q ?? "").trim();
  if (query.length < 2) return { ok: false, message: "Ketik minimal 2 huruf.", results: [] };
  let hits: GeniusEmployeeHit[];
  try {
    hits = await searchEmployees(query.slice(0, 60));
  } catch (e) {
    console.error("[impor tahunan] cari Genius gagal", e);
    return { ok: false, message: "Genius tidak bisa dihubungi. Coba lagi.", results: [] };
  }
  const codes = hits.map((h) => h.employeeCode);
  const { data } = codes.length ? await supabaseClosingAdmin().from("agents").select("id,employee_code").in("employee_code", codes) : { data: [] };
  const byCode = new Map((data ?? []).map((a) => [a.employee_code as string, a.id as string]));
  const results = hits.map((h) => ({ ...h, agentId: byCode.get(h.employeeCode) ?? null }));
  return { ok: true, message: results.length ? `${results.length} agen ditemukan.` : "Tidak ditemukan. Nama lengkap sering tidak ketemu: coba satu kata nama atau Agent ID.", results };
}

