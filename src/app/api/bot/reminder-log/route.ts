import { UUID_RX, bad, isoOrNull, json, officeById, periodByKey, readBody, strings, text, unauthorized } from "@/lib/bot/api";
import { refreshAll } from "@/lib/closing/cache";
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
  const db = supabaseClosingAdmin();
  const { error } = await db.from("reminder_log").insert(row);
  // message_id sama = laporan ulang (Hermes retry). Tidak dicatat dua kali, tapi antrean tetap ditutup di bawah
  // (laporan pertama bisa saja tersimpan lalu gagal sebelum antrean ditutup).
  const duplicate = error?.code === "23505";
  if (error && !duplicate) throw new Error(`Gagal simpan log reminder: ${error.message}`);
  // Tutup antrean: request_id dari /reminders/due, plus permintaan lain kantor ini yang sudah diambil bot
  // (kalau Hermes lupa mengirim request_id, kantor tetap tidak dikirimi ulang).
  const request_id = text(b.request_id);
  const close = { done_at: new Date().toISOString(), message_id };
  if (UUID_RX.test(request_id)) {
    const { error: e } = await db.from("bot_reminder_requests").update(close).eq("id", request_id).eq("cabang_id", office.id).is("done_at", null);
    if (e) throw new Error(`Gagal menutup permintaan: ${e.message}`);
  }
  const { error: e2 } = await db.from("bot_reminder_requests").update(close).eq("period_id", period.id).eq("cabang_id", office.id)
    .is("done_at", null).is("cancelled_at", null).not("claimed_at", "is", null);
  if (e2) throw new Error(`Gagal menutup permintaan: ${e2.message}`);
  if (duplicate) return json({ status: "ok", duplicate: true });
  refreshAll();
  await audit("bot_reminder", "reminder_log", message_id, { kantor: office.cabang_name, periode: text(b.period), mode, closing: closing_codes.length }, "bot WA");
  return json({ status: "ok", duplicate: false });
}
