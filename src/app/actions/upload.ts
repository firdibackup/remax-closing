"use server";

import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit, str } from "@/lib/closing/audit";
import { refreshAll } from "@/lib/closing/cache";
import { calcAmounts } from "@/lib/closing/calc";
import { parseKomisiSheet, type ExcelRow } from "@/lib/closing/excel-rows";
import { isInputOpen, periodState, type PeriodLike } from "@/lib/closing/periods";
import { loadPeriods } from "@/lib/closing/period-data";
import { fetchActiveLines } from "@/lib/supabase/fetch-lines";
import { readKomisiRows } from "@/lib/closing/xlsx";
import { suggestAgents } from "@/lib/closing/name-match";

// Upload file template kantor (PLAN §9 no. 9): baca → pratinjau + cek → Simpan ke Laporan Bulanan (source=excel).
// File-nya sendiri tidak disimpan; hanya baris hasil baca. Komisi dihitung ulang dengan tarif kantor di master;
// angka di file dibandingkan (selisih > Rp2 diperingatkan), lalu total file dibandingkan dengan data sistem.
// Simpan ulang untuk kantor + periode yang sama menggantikan upload Excel sebelumnya (baris lama dibatalkan, tidak dihapus).
// Kalau periode itu sudah punya baris dari Genius/impor, simpan harus dikonfirmasi supaya tidak terhitung dobel.

const MAX_BYTES = 5 * 1024 * 1024;
const TOLERANCE = 2;
const UUID = /^[0-9a-f-]{36}$/i;

export type Level = "amber" | "blue" | "red";
export type ReadLine = {
  row: number; tanggal: string | null; tanggalRaw: string; office: string; ma: string; agent: string | null;
  lsl: string; psr: string; resComm: string; soloCobroke: string; bayar: string; alamat: string;
  nilai: number; komisi: number; royalti: number; ssdf: number; keRmi: number; netKomisi: number;
  royaltiFile: number | null; ssdfFile: number | null; keRmiFile: number | null; warns: string[];
  // Nama MA tidak cocok persis: agen yang namanya mirip (HQ memilih, lalu nama file disimpan sebagai alias agen).
  suggestions?: { id: string; name: string; office: string | null; local: boolean }[];
};
export type Totals = { rows: number; komisi: number; royalti: number; ssdf: number; keRmi: number };
export type ReadResult = {
  ok: boolean; message: string; errors?: string[];
  fileName?: string; officeName?: string; periodLabel?: string; periodState?: string;
  meta?: { company: string; office: string; title: string; royalty: number | null; ssdf: number | null; kategori: "3.5" | "9" | "?" | null };
  officeKategori?: string; issues?: { lv: Level; t: string }[]; lines?: ReadLine[];
  file?: Totals; system?: Totals & { bySource: Record<string, number> };
  // Simpan: saveBlock = alasan tombol Simpan nonaktif; needsConfirm = sudah ada baris non-Excel (risiko dobel).
  saveBlock?: string | null; needsConfirm?: boolean; replaces?: number; saved?: boolean; periodId?: string;
} | null;

const SOURCE_LABEL: Record<string, string> = { import: "Impor Master", genius: "Genius", excel: "Excel", manual: "Manual" };
type Office = { id: string; office_code: string; cabang_name: string; induk_name: string; kategori: string; royalty_rate: number; ssdf_rate: number };
type Agent = { id: string; name: string; full_name: string | null; sheet_name: string | null; aliases: string[] | null; status: string };
type Assignment = { agent_id: string; office_id: string; start_date: string; end_date: string | null };

const failed = (message: string, errors?: string[]): ReadResult => ({ ok: false, message, errors });
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const pct = (v: number) => `${(v * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
const rp = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const label = (p: { month: number; year: number }) => `${BULAN[p.month - 1]} ${p.year}`;
const katOf = (royalty: number | null, ssdf: number | null): "3.5" | "9" | "?" | null => {
  if (royalty === null && ssdf === null) return null;
  const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-6;
  return near(royalty, 0.005) && near(ssdf, 0.03) ? "3.5" : near(royalty, 0.01) && near(ssdf, 0.08) ? "9" : "?";
};

// Nama MA di file ("Linawaty") → agen. Kunci: nama, nama lengkap, nama laporan, dan nama lengkap tanpa kata ganda
// ("LINAWATY LINAWATY" → "LINAWATY"). Kalau beberapa agen cocok, yang bertugas di kantor ini dipilih; tetap ganda = tidak dikenal.
function agentMatcher(agents: Agent[], officeAgents: Set<string>): (name: string) => Agent | null {
  const by = new Map<string, Agent[]>();
  const add = (k: string, a: Agent) => { if (k && !(by.get(k) ?? []).includes(a)) by.set(k, [...(by.get(k) ?? []), a]); };
  for (const a of agents) {
    for (const n of [a.name, a.full_name, a.sheet_name, ...(a.aliases ?? [])]) add(norm(n), a);
    if (a.full_name) add(norm([...new Set(a.full_name.trim().toUpperCase().split(/\s+/))].join(" ")), a);
  }
  return (name) => {
    const hits = by.get(norm(name)) ?? [];
    if (hits.length === 1) return hits[0];
    const local = hits.filter((a) => officeAgents.has(a.id));
    return local.length === 1 ? local[0] : null;
  };
}

function officeAt(list: Assignment[], iso: string | null): string | null {
  if (!iso) return null;
  return list.find((x) => x.start_date <= iso && (!x.end_date || x.end_date >= iso))?.office_id ?? null;
}

function sumOf(xs: { komisi: number; royalti: number; ssdf: number; keRmi: number }[]): Totals {
  return xs.reduce<Totals>((a, x) => ({ rows: a.rows + 1, komisi: a.komisi + x.komisi, royalti: a.royalti + x.royalti, ssdf: a.ssdf + x.ssdf, keRmi: a.keRmi + x.keRmi }), { rows: 0, komisi: 0, royalti: 0, ssdf: 0, keRmi: 0 });
}

export async function readExcel(_: ReadResult, fd: FormData): Promise<ReadResult> {
  const officeId = str(fd, "office_id"), periodPick = str(fd, "period_id"), file = fd.get("file");
  if (!UUID.test(officeId)) return failed("Pilih kantor dulu.");
  if (periodPick && !UUID.test(periodPick)) return failed("Periode tidak valid.");
  if (!(file instanceof File) || file.size === 0) return failed("Pilih file .xlsx dari kantor.");
  if (!/\.xlsx$/i.test(file.name)) return failed("File harus .xlsx (template Perhitungan Komisi). File .xls lama: buka di Excel lalu Save As .xlsx.");
  if (file.size > MAX_BYTES) return failed("File lebih dari 5 MB.");

  const db = supabaseClosingAdmin();
  const [o, a, s, cells, periods] = await Promise.all([
    db.from("offices").select("id,office_code,cabang_name,induk_name,kategori,royalty_rate,ssdf_rate").limit(1000),
    db.from("agents").select("id,name,full_name,sheet_name,aliases,status").limit(5000),
    db.from("agent_assignments").select("agent_id,office_id,start_date,end_date").limit(5000),
    file.arrayBuffer().then(readKomisiRows),
    loadPeriods(),
  ]);
  if (o.error || a.error || s.error) return failed(`Gagal membaca master: ${(o.error ?? a.error ?? s.error)?.message}`);
  if (typeof cells === "string") return failed(cells);
  const offices = (o.data ?? []) as Office[];
  const office = offices.find((x) => x.id === officeId);
  if (!office) return failed("Kantor tidak ditemukan.");

  const parsed = parseKomisiSheet(cells);
  if (!parsed.rows.length) return failed("File tidak bisa dibaca sebagai template Perhitungan Komisi.", parsed.errors);

  // Periode: pilihan pengguna, atau dari judul file ("PERHITUNGAN KOMISI PERIODE BULAN Agustus 2026").
  const { meta } = parsed;
  const fromTitle = periods.find((p) => p.month === meta.month && p.year === meta.year);
  const period = periods.find((p) => p.id === periodPick) ?? (periodPick ? undefined : fromTitle);

  const assignments = new Map<string, Assignment[]>();
  for (const x of (s.data ?? []) as Assignment[]) assignments.set(x.agent_id, [...(assignments.get(x.agent_id) ?? []), x]);
  const officeAgents = new Set([...assignments.values()].flat().filter((x) => x.office_id === office.id).map((x) => x.agent_id));
  const agentList = (a.data ?? []) as Agent[];
  const agentOf = agentMatcher(agentList, officeAgents);
  const today = new Date().toISOString().slice(0, 10);
  const candidates = agentList.filter((x) => x.status === "aktif").map((x) => ({ id: x.id, names: [x.name, x.full_name, x.sheet_name, ...(x.aliases ?? [])], local: officeAgents.has(x.id) }));
  const suggest = (name: string): NonNullable<ReadLine["suggestions"]> => suggestAgents(name, candidates).map((sg) => {
    const ag = agentList.find((x) => x.id === sg.id)!;
    const at = officeAt(assignments.get(ag.id) ?? [], today);
    return { id: ag.id, name: ag.full_name ?? ag.name, office: at ? offices.find((x) => x.id === at)?.cabang_name ?? null : null, local: officeAgents.has(ag.id) };
  });
  const byCode = new Map(offices.map((x) => [norm(x.office_code), x]));
  const byName = new Map(offices.map((x) => [norm(x.cabang_name), x]));
  const officeOfFile = (v: string) => byName.get(norm(v)) ?? byCode.get(norm(v)) ?? null;

  const issues: { lv: Level; t: string }[] = [];
  const onlyOffice = fd.get("only_office") === "on";
  const rows: ExcelRow[] = onlyOffice ? parsed.rows.filter((r) => !r.office || officeOfFile(r.office)?.id === office.id) : parsed.rows;
  const skipped = parsed.rows.length - rows.length;

  const royaltyRate = Number(office.royalty_rate), ssdfRate = Number(office.ssdf_rate);
  const fileKat = katOf(parsed.rates.royalty, parsed.rates.ssdf);
  if ((parsed.rates.royalty !== null && Math.abs(parsed.rates.royalty - royaltyRate) > 1e-6) || (parsed.rates.ssdf !== null && Math.abs(parsed.rates.ssdf - ssdfRate) > 1e-6)) {
    issues.push({ lv: "amber", t: `Tarif di file (Royalti ${pct(parsed.rates.royalty ?? 0)} · SSDF ${pct(parsed.rates.ssdf ?? 0)}) beda dengan kebijakan ${office.cabang_name} (Royalti ${pct(royaltyRate)} · SSDF ${pct(ssdfRate)}). Hitungan di bawah memakai tarif kantor.` });
  }
  if (meta.month && period && (meta.month !== period.month || meta.year !== period.year)) {
    issues.push({ lv: "amber", t: `Judul file menyebut ${BULAN[meta.month - 1]} ${meta.year}, tetapi periode yang dipilih ${label(period)}.` });
  }
  if (!period) issues.push({ lv: "blue", t: meta.month ? `Periode ${BULAN[meta.month - 1]} ${meta.year} dari judul file belum ada di sistem, jadi tidak ada pembanding data sistem.` : "Periode tidak terbaca dari judul file. Pilih periode untuk membandingkan dengan data sistem." });
  if (skipped) issues.push({ lv: "blue", t: `${skipped} baris milik kantor lain dilewati (opsi “hanya baris kantor ini” aktif).` });
  for (const e of parsed.errors) issues.push({ lv: "red", t: e });

  const agentIds: (string | null)[] = [];
  const lines: ReadLine[] = rows.map((r) => {
    const calc = calcAmounts(r.komisi_gross, royaltyRate, ssdfRate);
    const warns: string[] = [];
    const fo = r.office ? officeOfFile(r.office) : null;
    if (r.office && !fo) warns.push(`Office “${r.office}” tidak dikenal di List Office.`);
    else if (fo && fo.id !== office.id) warns.push(`Office di file ${fo.cabang_name}, bukan ${office.cabang_name}.`);
    if (!r.tanggal) warns.push(r.tanggal_raw ? `Tanggal “${r.tanggal_raw}” tidak terbaca. Perbaiki formatnya di file.` : "Tanggal transaksi kosong.");
    else if (r.tanggal_guessed) warns.push(`Tanggal “${r.tanggal_raw}” dibaca sebagai ${r.tanggal}. Pastikan benar.`);
    if (r.royalti_file !== null && Math.abs(r.royalti_file - calc.royalti) > TOLERANCE) warns.push(`Royalti di file ${rp(r.royalti_file)} ≠ hitung ${rp(calc.royalti)}.`);
    if (r.ssdf_file !== null && Math.abs(r.ssdf_file - calc.ssdf) > TOLERANCE) warns.push(`SSDF di file ${rp(r.ssdf_file)} ≠ hitung ${rp(calc.ssdf)}.`);
    if (r.ke_rmi_file !== null && Math.abs(r.ke_rmi_file - calc.ke_rmi) > TOLERANCE) warns.push(`Ke RMI di file ${rp(r.ke_rmi_file)} ≠ hitung ${rp(calc.ke_rmi)}.`);
    const ag = agentOf(r.ma_name);
    agentIds.push(ag?.id ?? null);
    const suggestions = !ag && r.ma_name ? suggest(r.ma_name) : [];
    if (!ag) warns.push(suggestions.length ? `MA “${r.ma_name}” tidak cocok persis dengan List Agent. Pilih agen yang dimaksud di bawah, atau biarkan kosong.` : `MA “${r.ma_name}” belum ada di List Agent.`);
    else {
      const at = officeAt(assignments.get(ag.id) ?? [], r.tanggal);
      const atName = at ? offices.find((x) => x.id === at)?.cabang_name : null;
      if (r.tanggal && at !== office.id) warns.push(`Pada ${r.tanggal} ${ag.full_name ?? ag.name} terdaftar di ${atName ?? "kantor lain / tidak aktif"}, bukan ${office.cabang_name}.`);
    }
    return {
      row: r.row, tanggal: r.tanggal, tanggalRaw: r.tanggal_raw, office: r.office, ma: r.ma_name, agent: ag ? ag.full_name ?? ag.name : null,
      lsl: r.lsl, psr: r.psr, resComm: r.res_comm, soloCobroke: r.solo_cobroke, bayar: r.bayar_via, alamat: r.alamat,
      nilai: r.nilai_transaksi, komisi: calc.komisi_gross, royalti: calc.royalti, ssdf: calc.ssdf, keRmi: calc.ke_rmi, netKomisi: calc.net_komisi,
      royaltiFile: r.royalti_file, ssdfFile: r.ssdf_file, keRmiFile: r.ke_rmi_file, warns,
      ...(suggestions.length ? { suggestions } : {}),
    };
  });

  // Pembanding: data yang sudah tercatat di sistem (Genius / impor / Excel) untuk kantor & periode ini.
  let system: (Totals & { bySource: Record<string, number> }) | undefined;
  if (period) {
    const mine = (await fetchActiveLines()).filter((l) => l.cabang_id === office.id && l.periods?.id === period.id);
    const n = (v: number | string | null) => Number(v) || 0;
    const bySource: Record<string, number> = {};
    for (const l of mine) bySource[l.source] = (bySource[l.source] ?? 0) + 1;
    system = { ...sumOf(mine.map((l) => ({ komisi: n(l.komisi_gross), royalti: n(l.royalti), ssdf: n(l.ssdf), keRmi: n(l.ke_rmi) }))), bySource };
  }
  const fileTotals = sumOf(lines);
  if (system && system.rows && Math.abs(system.komisi - fileTotals.komisi) > TOLERANCE) {
    issues.push({ lv: "amber", t: `Total komisi file ${rp(fileTotals.komisi)} beda ${rp(Math.abs(system.komisi - fileTotals.komisi))} dengan data sistem ${rp(system.komisi)} (${system.rows} baris).` });
  }

  const excelRows = system?.bySource.excel ?? 0;
  const otherRows = (system?.rows ?? 0) - excelRows;
  const saveBlock = !lines.length ? "Tidak ada baris untuk disimpan."
    : !period ? "Pilih periode laporan dulu (periode tidak terbaca dari judul file)."
    : !isInputOpen(period as PeriodLike) ? `Periode ${label(period)} ${periodState(period as PeriodLike) === "future" ? "belum mulai" : "terkunci"}. Buka kunci di Periode & Cut-off untuk menyimpan.`
    : null;
  if (otherRows > 0) {
    const src = Object.entries(system!.bySource).filter(([k]) => k !== "excel").map(([k, v]) => `${v} ${SOURCE_LABEL[k] ?? k}`).join(", ");
    issues.unshift({ lv: "red", t: `${office.cabang_name} sudah punya ${otherRows} baris di ${label(period!)} (${src}). Kalau file ini berisi transaksi yang sama, menyimpan akan membuat laporan dobel.` });
  }
  if (excelRows > 0) issues.push({ lv: "blue", t: `Sudah ada ${excelRows} baris upload Excel untuk ${office.cabang_name} di ${label(period!)}. Simpan akan menggantinya.` });

  const result: ReadResult = {
    ok: true,
    message: `${lines.length} baris terbaca dari ${file.name}.`,
    fileName: file.name, officeName: office.cabang_name, officeKategori: office.kategori,
    periodLabel: period ? label(period) : undefined, periodState: period ? periodState(period as PeriodLike) : undefined, periodId: period?.id,
    meta: { company: meta.company, office: meta.office, title: meta.title, royalty: parsed.rates.royalty, ssdf: parsed.rates.ssdf, kategori: fileKat },
    issues, lines, file: fileTotals, system, saveBlock, needsConfirm: otherRows > 0, replaces: excelRows,
  };
  if (str(fd, "intent") !== "save") return result;

  // --- Simpan ke Laporan Bulanan ---
  if (saveBlock || !period) return { ...result, ok: false, message: saveBlock ?? "Periode belum dipilih." };
  if (otherRows > 0 && fd.get("confirm_dup") !== "on") return { ...result, ok: false, message: "Centang konfirmasi dulu: periode ini sudah punya data dari sumber lain." };
  const insert = rows.map((r, i) => {
    const amounts = calcAmounts(r.komisi_gross, royaltyRate, ssdfRate);
    return {
      period_id: period.id, cabang_id: office.id, source: "excel", tanggal_transaksi: r.tanggal, bayar_via: r.bayar_via || null, plafond_kpr: r.plafond_kpr,
      res_comm: r.res_comm || null, solo_cobroke: r.solo_cobroke || null, psr: r.psr || null, lsl: r.lsl || null, ma_name: r.ma_name, agent_id: agentIds[i],
      nilai_transaksi: r.nilai_transaksi, alamat: r.alamat || null, kantor_cobroke: r.kantor_cobroke || null, ma_cobroke: r.ma_cobroke || null,
      komisi_pct: r.komisi_pct, royalty_rate: royaltyRate, ssdf_rate: ssdfRate, ...amounts,
      original: {
        file: file.name, file_row: r.row, office_file: r.office || null, ma_ktp: r.ma_ktp || null, tanggal_file: r.tanggal_raw || null,
        royalti_file: r.royalti_file, ssdf_file: r.ssdf_file, ke_rmi_file: r.ke_rmi_file, warns: lines[i].warns,
      },
    };
  });
  // Sisipkan dulu, baru batalkan upload lama, supaya data lama tidak hilang kalau simpan gagal.
  const { data: inserted, error: insErr } = await db.from("commission_lines").insert(insert).select("id");
  if (insErr) return { ...result, ok: false, message: `Gagal menyimpan: ${insErr.message}` };
  const newIds = (inserted ?? []).map((r) => r.id as string);
  const { data: replaced, error: rErr } = await db.from("commission_lines").update({ batal_at: new Date().toISOString() })
    .eq("source", "excel").eq("cabang_id", office.id).eq("period_id", period.id).is("batal_at", null)
    .not("id", "in", `(${newIds.join(",")})`).select("id");
  if (rErr) return { ...result, ok: false, message: `Baris baru tersimpan, tetapi upload lama gagal dibatalkan: ${rErr.message}. Batalkan manual di Laporan Bulanan.` };
  await audit("upload_excel", "commission_lines", office.id, { file: file.name, period_id: period.id, lines: newIds.length, replaced: (replaced ?? []).length, confirm_dup: otherRows > 0 });
  refreshAll();
  const replacedMsg = replaced?.length ? ` ${replaced.length} baris upload sebelumnya dibatalkan.` : "";
  return { ...result, saved: true, saveBlock: "Sudah tersimpan.", message: `${newIds.length} baris ${office.cabang_name} tersimpan ke Laporan Bulanan ${label(period)}.${replacedMsg}` };
}

// "Pakai" pada saran nama mirip: nama MA dari file disimpan sebagai alias agen, lalu file dibaca ulang dan barisnya cocok.
// Bulan berikutnya nama yang sama langsung cocok tanpa perlu memilih lagi.
export async function addAgentAlias(agentId: string, alias: string): Promise<{ ok: boolean; message: string }> {
  const name = alias.trim().replace(/\s+/g, " ");
  if (!UUID.test(agentId) || !name || name.length > 120) return { ok: false, message: "Data tidak valid." };
  const db = supabaseClosingAdmin();
  const { data: ag, error } = await db.from("agents").select("id,name,full_name,aliases").eq("id", agentId).maybeSingle();
  if (error || !ag) return { ok: false, message: error ? `Gagal membaca agen: ${error.message}` : "Agen tidak ditemukan." };
  const aliases = (ag.aliases as string[] | null) ?? [];
  if (!aliases.some((x) => norm(x) === norm(name))) {
    const { error: upErr } = await db.from("agents").update({ aliases: [...aliases, name], updated_at: new Date().toISOString() }).eq("id", agentId);
    if (upErr) return { ok: false, message: `Gagal menyimpan: ${upErr.message}` };
    await audit("agen_alias", "agents", agentId, { agen: ag.full_name ?? ag.name, alias: name });
  }
  refreshAll();
  return { ok: true, message: `“${name}” sekarang dikenali sebagai ${ag.full_name ?? ag.name}.` };
}
