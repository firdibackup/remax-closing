"use server";

import { refreshAll } from "@/lib/closing/cache";
import { redirect } from "next/navigation";
import { isReady, type ClosingPreview } from "@/lib/genius/pull";
import { previewCodes, storeClosings } from "@/lib/genius/save";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit, str } from "@/lib/closing/audit";
import { parseCodes } from "@/lib/closing/codes";
import { isFuture, isWritable, type PeriodLike } from "@/lib/closing/periods";

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

export async function previewClosings(codes: string[], periodId: string): Promise<ClosingPreview[]> {
  return previewCodes(codes, periodId);
}

const back = (codes: string[], period: string, extra: string) =>
  `/input?codes=${encodeURIComponent(codes.join("\n"))}&period=${period}${extra}`;

export async function saveClosings(fd: FormData) {
  const codes = parseCodes(str(fd, "codes"));
  const period = str(fd, "period");
  const p = await periodFor(period);
  if (typeof p === "string") redirect(back(codes, period, `&err=${encodeURIComponent(p)}`));

  const expected = codes.filter((code) => fd.has(`invoice:${code}`));
  const ready = (await previewCodes(expected, p.id)).filter(isReady);
  if (!expected.length || ready.length !== expected.length || ready.some((pv) => pv.selectedInvoice !== fd.get(`invoice:${pv.closingCode}`))) {
    redirect(back(codes, period, `&err=${encodeURIComponent("Pratinjau invoice berubah. Periksa kembali termin sebelum menyimpan.")}`));
  }
  const { lines: savedLines, codes: savedClosings } = await storeClosings(ready, p.id);
  await audit("Input closing Genius", "commission_lines", savedClosings.join(",") || null, { lines: savedLines, period });
  refreshAll();
  // Setelah simpan, kotak Closing ID dikosongkan (seperti mockup); hasilnya terlihat di "Sudah tersimpan".
  redirect(`/input?period=${period}&saved=${savedLines}`);
}
