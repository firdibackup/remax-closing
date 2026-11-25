"use server";

import { refreshAll } from "@/lib/closing/cache";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { calcAmounts } from "@/lib/closing/calc";
import { audit, fail, money, ok, str, type ActionResult } from "@/lib/closing/audit";
import { isWritable, type PeriodLike } from "@/lib/closing/periods";

// Ubah / batal / pulihkan baris laporan (PLAN §9a). Hanya baris Genius/Excel/manual di periode terbuka; impor historis terkunci.
const EDITABLE = ["ma_name", "bayar_via", "res_comm", "solo_cobroke", "psr", "lsl", "nilai_transaksi", "alamat", "kantor_cobroke", "ma_cobroke", "komisi_gross"] as const;

type Line = Record<string, unknown> & { id: string; source: string; batal_at: string | null; closing_code: string | null; period_id: string; royalty_rate: number; ssdf_rate: number; original: Record<string, unknown> | null; periods: PeriodLike | null };
const PERIOD_SELECT = "periods!period_id(status,year,month,cutoff_at)";
const LOCKED_MSG = "Periode sudah terkunci atau lewat cut-off. Buka kunci di Periode & Cut-off dulu.";

async function loadLine(id: string): Promise<Line | string> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return "ID baris tidak valid.";
  const { data, error } = await supabaseClosingAdmin().from("commission_lines").select(`id,source,batal_at,closing_code,period_id,royalty_rate,ssdf_rate,original,${EDITABLE.join(",")},${PERIOD_SELECT}`).eq("id", id).single();
  if (error || !data) return `Baris tidak ditemukan${error ? `: ${error.message}` : ""}.`;
  const line = data as unknown as Line;
  if (line.source === "import") return "Baris impor historis tidak bisa diubah.";
  if (!line.periods || !isWritable(line.periods)) return LOCKED_MSG;
  return line;
}

const done = (msg: string) => { refreshAll(); return ok(msg); };

export async function editLine(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const line = await loadLine(str(fd, "id"));
  if (typeof line === "string") return fail(line);
  const reason = str(fd, "reason");
  if (!reason) return fail("Alasan wajib diisi.");
  const next: Record<string, string | number | null> = {};
  for (const k of EDITABLE) next[k] = k === "nilai_transaksi" || k === "komisi_gross" ? money(fd, k) : str(fd, k) || null;
  if (!next.ma_name) return fail("MA wajib diisi.");
  if (!(Number(next.komisi_gross) > 0)) return fail("Komisi Gross harus lebih dari 0.");
  const changed = EDITABLE.filter((k) => String(line[k] ?? "") !== String(next[k] ?? "") && !(typeof next[k] === "number" && Number(line[k]) === next[k]));
  if (!changed.length) return fail("Tidak ada perubahan.");
  const before = Object.fromEntries(changed.map((k) => [k, line[k]]));
  // original menyimpan nilai sebelum ubah pertama + angka pembanding Genius (genius_royalti/genius_ssdf).
  const original = { ...Object.fromEntries(EDITABLE.map((k) => [k, line[k]])), ...(line.original ?? {}) };
  const update = { ...next, ...calcAmounts(Number(next.komisi_gross), Number(line.royalty_rate), Number(line.ssdf_rate)), original };
  const { error } = await supabaseClosingAdmin().from("commission_lines").update(update).eq("id", line.id);
  if (error) return fail(`Gagal menyimpan: ${error.message}`);
  await audit("ubah_baris", "commission_lines", line.id, { reason, before, after: Object.fromEntries(changed.map((k) => [k, next[k]])) });
  return done("Baris disimpan. Royalti, SSDF, Ke RMI, dan Net dihitung ulang; Data Tahunan, GC, dan Rekonsiliasi ikut berubah.");
}

export async function cancelLine(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const line = await loadLine(str(fd, "id"));
  if (typeof line === "string") return fail(line);
  const reason = str(fd, "reason");
  if (!reason) return fail("Alasan wajib diisi.");
  const db = supabaseClosingAdmin();
  let ids = [line.id];
  if (fd.get("whole") === "on" && line.closing_code) {
    const { data } = await db.from("commission_lines").select("id").eq("closing_code", line.closing_code).eq("period_id", line.period_id).is("batal_at", null);
    ids = [...new Set([line.id, ...(data ?? []).map((r) => r.id as string)])];
  }
  const { error } = await db.from("commission_lines").update({ batal_at: new Date().toISOString() }).in("id", ids);
  if (error) return fail(`Gagal membatalkan: ${error.message}`);
  await audit("batal_baris", "commission_lines", line.id, { reason, ids, closing_code: line.closing_code });
  return done(`${ids.length} baris dibatalkan. Tidak dihitung lagi di laporan, Data Tahunan, GC, Top MA, dan Rekonsiliasi.`);
}

export async function restoreLine(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("ID baris tidak valid.");
  const db = supabaseClosingAdmin();
  const { data, error } = await db.from("commission_lines").select(`id,invoice_number,ma_name,${PERIOD_SELECT}`).eq("id", id).single();
  if (error || !data) return fail("Baris tidak ditemukan.");
  const period = data.periods as unknown as PeriodLike | null;
  if (!period || !isWritable(period)) return fail(LOCKED_MSG);
  if (data.invoice_number) {
    const { count } = await db.from("commission_lines").select("id", { count: "exact", head: true }).eq("invoice_number", data.invoice_number).eq("ma_name", data.ma_name).is("batal_at", null);
    if (count) return fail("Invoice ini sudah diinput ulang, jadi baris lama tidak bisa dipulihkan.");
  }
  const { error: e2 } = await db.from("commission_lines").update({ batal_at: null }).eq("id", id);
  if (e2) return fail(`Gagal memulihkan: ${e2.message}`);
  await audit("pulihkan_baris", "commission_lines", id, {});
  return done("Baris dipulihkan dan kembali dihitung di semua laporan.");
}

// Upload Excel → "Upload tersimpan" → Hapus: batalkan semua baris Excel satu kantor di satu periode.
export async function cancelUpload(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const officeId = str(fd, "office_id"), periodId = str(fd, "period_id"), reason = str(fd, "reason");
  if (!/^[0-9a-f-]{36}$/i.test(officeId) || !/^[0-9a-f-]{36}$/i.test(periodId)) return fail("Kantor/periode tidak valid.");
  if (!reason) return fail("Alasan wajib diisi.");
  const db = supabaseClosingAdmin();
  const { data: p, error: pErr } = await db.from("periods").select("year,month,status,cutoff_at").eq("id", periodId).maybeSingle();
  if (pErr) return fail(`Gagal baca periode: ${pErr.message}`);
  if (!p || !isWritable(p as PeriodLike)) return fail(LOCKED_MSG);
  const { data, error } = await db.from("commission_lines").update({ batal_at: new Date().toISOString() })
    .eq("source", "excel").eq("cabang_id", officeId).eq("period_id", periodId).is("batal_at", null).select("id");
  if (error) return fail(`Gagal menghapus upload: ${error.message}`);
  const ids = (data ?? []).map((r) => r.id as string);
  if (!ids.length) return fail("Tidak ada baris Excel aktif untuk kantor & periode ini.");
  await audit("hapus_upload_excel", "commission_lines", officeId, { reason, period_id: periodId, ids });
  return done(`${ids.length} baris Excel dibatalkan.`);
}
