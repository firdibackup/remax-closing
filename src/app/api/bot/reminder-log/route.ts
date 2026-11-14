import { bad, isoOrNull, json, officeById, periodByKey, readBody, strings, text, unauthorized } from "@/lib/bot/api";
import { audit } from "@/lib/closing/audit";
import { normalizePhone } from "@/lib/closing/phone";
import { supabaseClosingAdmin } from "@/lib/supabase/client";

// POST /api/bot/reminder-log: Hermes melapor reminder sudah terkirim. message_id sama → tidak dicatat dua kali.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const b = await readBody(req);
  if (!b) return bad("Body harus JSON object.");
  const message_id = text(b.message_id), mode = text(b.mode), sent_at = isoOrNull(b.sent_at) ?? new Date().toISOString();
  if (!message_id) return bad("message_id wajib diisi.");
  if (mode !== "genius" && mode !== "excel") return bad('mode harus "genius" atau "excel".');
  const [office, period] = await Promise.all([officeById(text(b.cabang_id)), periodByKey(text(b.period))]);
  if (!office) return bad("cabang_id tidak dikenal.");
  if (!period) return bad("period tidak dikenal (format YYYY-MM).");

  const closing_codes = strings(b.closing_codes).map((c) => c.toUpperCase());
  const row = { period_id: period.id, cabang_id: office.id, mode, sent_at, sent_to: normalizePhone(text(b.sent_to)) ?? (text(b.sent_to) || null), closing_codes, message_id };
  const { error } = await supabaseClosingAdmin().from("reminder_log").insert(row);
  if (error?.code === "23505") return json({ status: "ok", duplicate: true });
  if (error) throw new Error(`Gagal simpan log reminder: ${error.message}`);
  await audit("bot_reminder", "reminder_log", message_id, { kantor: office.cabang_name, periode: text(b.period), mode, closing: closing_codes.length }, "bot WA");
  return json({ status: "ok", duplicate: false });
}
