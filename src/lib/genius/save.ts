import "server-only";

import { buildClosingPreview, freshLines, loadContext, type ClosingPreview } from "@/lib/genius/pull";
import { invoiceHistory } from "@/lib/closing/reported";
import { nextInstallment } from "@/lib/genius/installment";
import { importDuplicateWarnings, type ImportRow } from "@/lib/closing/import-match";
import { supabaseClosingAdmin } from "@/lib/supabase/client";

// Tarik + simpan closing Genius. Dipakai halaman Input dan konfirmasi bot WA, jadi aturan dobel invoice
// dan master yang ditahan ada di satu tempat.

export async function previewCodes(codes: string[], periodId: string): Promise<ClosingPreview[]> {
  const ctx = await loadContext();
  const out: ClosingPreview[] = [];
  for (const code of codes) out.push(await buildClosingPreview(code, ctx));
  const { reported, inPeriod } = await invoiceHistory(out.flatMap((p) => p.invoices.map((v) => v.number)), periodId);
  const previews = out.map((p) => ({
    ...p,
    selectedInvoice: nextInstallment(p.invoices, reported, inPeriod),
    reported: p.invoices.map((v) => v.number).filter((n) => reported.has(n)),
  }));
  const imports = await importRowsFor(previews.flatMap(freshLines));
  return previews.map((p) => ({ ...p, warnings: [...p.warnings, ...importDuplicateWarnings(freshLines(p), imports)] }));
}

// Baris impor Excel aktif di kantor dan komisi yang sama dengan pratinjau (kandidat dobel, lihat import-match.ts).
async function importRowsFor(lines: ClosingPreview["lines"]): Promise<ImportRow[]> {
  if (lines.length === 0) return [];
  const { data, error } = await supabaseClosingAdmin().from("commission_lines")
    .select("cabang_id,komisi_gross,ma_name,periods!period_id(year,month)")
    .eq("source", "import").is("batal_at", null)
    .in("cabang_id", [...new Set(lines.map((l) => l.cabang_id))])
    .in("komisi_gross", [...new Set(lines.map((l) => l.komisi_gross))]);
  if (error) throw new Error(`Gagal cek data impor: ${error.message}`);
  type Row = { cabang_id: string; komisi_gross: number; ma_name: string | null; periods: { year: number; month: number } | null };
  return ((data ?? []) as unknown as Row[]).flatMap((r) => (r.periods ? [{ ...r, year: r.periods.year, month: r.periods.month }] : []));
}

// Simpan closing yang siap (isReady) ke periode. Mengembalikan jumlah baris dan Closing ID yang tersimpan.
export async function storeClosings(ready: ClosingPreview[], periodId: string): Promise<{ lines: number; codes: string[] }> {
  const db = supabaseClosingAdmin();
  let lines = 0;
  const codes: string[] = [];
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
    const rows = fresh.map((l) => ({ ...Object.fromEntries(Object.entries(l).filter(([k]) => k !== "cabang_name")), period_id: periodId, source: "genius", batal_at: null }));
    const { error: insErr } = await db.from("commission_lines").insert(rows);
    if (insErr) throw new Error(insErr.message);
    lines += rows.length;
    codes.push(pv.closingCode);
  }
  return { lines, codes };
}
