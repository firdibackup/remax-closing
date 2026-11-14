import "server-only";

import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit } from "@/lib/closing/audit";
import { cutoffOf, isWritable } from "@/lib/closing/periods";
import { loadPeriods } from "@/lib/closing/period-data";
import { invalidateData } from "@/lib/closing/cache";

// Kunci otomatis periode yang lewat cut-off (PLAN §6). Dipanggil layout sebelum halaman dirender;
// setiap server action tetap memeriksa isWritable() sendiri.
export async function autoLockPeriods(): Promise<void> {
  // Cek dari cache periode: biasanya tidak ada yang jatuh tempo, jadi tidak ada query ke Supabase.
  const due = (await loadPeriods()).filter((p) => p.status === "open" && !isWritable(p));
  if (!due.length) return;
  const db = supabaseClosingAdmin();
  // Beberapa request bisa jalan bersamaan (prefetch menu); audit hanya untuk baris yang benar-benar berubah di request ini.
  const { data: locked, error: upErr } = await db.from("periods")
    .update({ status: "locked", locked_at: new Date().toISOString(), locked_by: "otomatis (cut-off)" })
    .in("id", due.map((p) => p.id)).eq("status", "open").select("id");
  if (upErr) throw new Error(`Gagal mengunci periode: ${upErr.message}`);
  const ids = (locked ?? []).map((r) => r.id as string);
  // Sudah dikunci request lain: cache periode masih "open", buang supaya tidak dicek ulang terus.
  if (!ids.length) return invalidateData();
  await audit("kunci_otomatis", "periods", ids.join(","), { cutoff: due.filter((p) => ids.includes(p.id)).map(cutoffOf) });
}
