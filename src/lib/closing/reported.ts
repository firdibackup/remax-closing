import "server-only";

import { supabaseClosingAdmin } from "@/lib/supabase/client";

const IN_CHUNK = 100;

// Invoice yang sudah pernah dilaporkan (PLAN §6, §8 langkah 4): ada baris aktif di sistem, atau ditandai
// impor "List Data Office" (report_entries) untuk bulan sebelum sistem jalan. Invoice ini tidak dihitung lagi.
export async function reportedInvoices(numbers: string[]): Promise<Set<string>> {
  const unique = [...new Set(numbers)];
  const db = supabaseClosingAdmin();
  const found: string[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const chunk = unique.slice(i, i + IN_CHUNK);
    const [lines, entries] = await Promise.all([
      db.from("commission_lines").select("invoice_number").in("invoice_number", chunk).is("batal_at", null),
      db.from("invoices").select("invoice_number,report_entries!inner(id)").in("invoice_number", chunk),
    ]);
    if (lines.error) throw new Error(`Gagal cek invoice: ${lines.error.message}`);
    if (entries.error) throw new Error(`Gagal cek invoice impor: ${entries.error.message}`);
    found.push(...[...(lines.data ?? []), ...(entries.data ?? [])].map((r) => r.invoice_number as string));
  }
  return new Set(found);
}
