import "server-only";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { invalidateData } from "@/lib/closing/cache";

// Semua perubahan data dicatat di closing.audit_log (PLAN §9a, keputusan CEO).
// Setiap perubahan lewat aplikasi berakhir di sini, jadi cache data dikosongkan juga di sini.
export async function audit(action: string, entity: string, entityId: string | null, diff: Record<string, unknown>, actor = "superadmin") {
  invalidateData();
  const { error } = await supabaseClosingAdmin().from("audit_log").insert({ actor, action, entity, entity_id: entityId, diff });
  if (error) throw new Error(`Gagal menulis audit log: ${error.message}`);
}

export type ActionResult = { ok: boolean; message: string } | null;
export const ok = (message: string): ActionResult => ({ ok: true, message });
export const fail = (message: string): ActionResult => ({ ok: false, message });
export const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
export const money = (fd: FormData, k: string) => Math.round(Number(str(fd, k).replace(/[^\d]/g, "")) || 0);
