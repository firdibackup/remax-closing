"use server";

import { refreshAll } from "@/lib/closing/cache";
import { redirect } from "next/navigation";
import { buildClosingPreview, freshLines, isReady, loadContext, type ClosingPreview } from "@/lib/genius/pull";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit, str } from "@/lib/closing/audit";
import { parseCodes } from "@/lib/closing/codes";
import { isFuture, isWritable, type PeriodLike } from "@/lib/closing/periods";
import { reportedInvoices } from "@/lib/closing/reported";

// Simpan closing Genius ke closing.commission_lines (PLAN §3.5a, §5). Closing dengan agen/kantor
// belum di master tidak disimpan (ditahan). Invoice yang sudah pernah dilaporkan (baris aktif atau impor
// List Data Office) tidak dihitung dua kali.


// Periode tujuan input; string = alasan tidak bisa ditulis (belum ada, terkunci, atau lewat cut-off).
export async function periodFor(yyyymm: string): Promise<{ id: string } | string> {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyymm);
  if (!m) return "Periode tidak valid.";
  const { data, error } = await supabaseClosingAdmin().from("periods").select("id,year,month,status,cutoff_at")
    .eq("year", Number(m[1])).eq("month", Number(m[2])).maybeSingle();
  if (error) return error.message;
  if (!data) return "Periode belum dibuat. Buat di Periode & Cut-off.";
  const p = data as PeriodLike & { id: string };
  if (isFuture(p)) return "Periode belum mulai. Pilih periode yang sedang berjalan.";
  if (!isWritable(p)) return "Periode terkunci atau lewat cut-off. Buka kunci di Periode & Cut-off dulu.";
  return { id: p.id };
}

export async function previewClosings(codes: string[]): Promise<ClosingPreview[]> {
  const ctx = await loadContext();
  const out: ClosingPreview[] = [];
  for (const code of codes) out.push(await buildClosingPreview(code, ctx));
  const reported = await reportedInvoices(out.flatMap((p) => p.invoices.map((v) => v.number)));
  return out.map((p) => ({ ...p, reported: p.invoices.map((v) => v.number).filter((n) => reported.has(n)) }));
}

const back = (codes: string[], period: string, extra: string) =>
  `/input?codes=${encodeURIComponent(codes.join("\n"))}&period=${period}${extra}`;

export async function saveClosings(fd: FormData) {
  const codes = parseCodes(str(fd, "codes"));
  const period = str(fd, "period");
  const p = await periodFor(period);
  if (typeof p === "string") redirect(back(codes, period, `&err=${encodeURIComponent(p)}`));

  const ready = (await previewClosings(codes)).filter(isReady);
  const db = supabaseClosingAdmin();

  let savedLines = 0;
  const savedClosings: string[] = [];
  for (const pv of ready) {
    const fresh = freshLines(pv);
    const { data: cl, error: clErr } = await db.from("closings")
      .upsert({ closing_code: pv.closingCode, genius_closing_id: pv.closingId, closing_date: fresh[0].tanggal_transaksi, snapshot: {}, fetched_at: new Date().toISOString() }, { onConflict: "closing_code" })
      .select("id").single();
    if (clErr || !cl) throw new Error(clErr?.message ?? "gagal simpan closing");
    const invRows = pv.invoices
      .filter((v) => fresh.some((l) => l.invoice_number === v.number))
      .map((v) => ({ invoice_number: v.number, closing_id: cl.id, phase: v.phase, total_phase: v.totalPhase, percentage: v.percentage, amount: v.amount }));
    if (invRows.length) {
      const { error: invErr } = await db.from("invoices").upsert(invRows, { onConflict: "invoice_number" });
      if (invErr) throw new Error(invErr.message);
    }
    const rows = fresh.map((l) => ({ ...Object.fromEntries(Object.entries(l).filter(([k]) => k !== "cabang_name")), period_id: p.id, source: "genius", batal_at: null }));
    const { error: insErr } = await db.from("commission_lines").insert(rows);
    if (insErr) throw new Error(insErr.message);
    savedLines += rows.length;
    savedClosings.push(pv.closingCode);
  }
  await audit("Input closing Genius", "commission_lines", savedClosings.join(",") || null, { lines: savedLines, period });
  refreshAll();
  // Setelah simpan, kotak Closing ID dikosongkan (seperti mockup); hasilnya terlihat di "Sudah tersimpan".
  redirect(`/input?period=${period}&saved=${savedLines}`);
}
