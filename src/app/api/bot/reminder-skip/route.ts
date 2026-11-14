import { UUID_RX, bad, json, officeById, periodByKey, readBody, text, unauthorized } from "@/lib/bot/api";
import { SKIP_REASONS, isSkipReason } from "@/lib/bot/schedule";
import { audit } from "@/lib/closing/audit";
import { supabaseClosingAdmin } from "@/lib/supabase/client";

// POST /api/bot/reminder-skip: Hermes mengambil kantor dari /reminders/due tapi tidak mengirim WA
// (mis. semua closing sudah dilaporkan). Antrean ditutup supaya kantor tidak diberikan ulang, tanpa entri reminder_log
// (Rekon tidak menampilkan "WA reminder terkirim"). Beranda menampilkan alasannya di kartu kantor.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const b = await readBody(req);
  if (!b) return bad("Body harus JSON object.");
  const request_id = text(b.request_id), reason = text(b.reason), note = text(b.note).slice(0, 200);
  if (!UUID_RX.test(request_id)) return bad("request_id wajib diisi (dari /reminders/due).");
  if (!isSkipReason(reason)) return bad(`reason harus salah satu: ${Object.keys(SKIP_REASONS).join(", ")}.`);
  const [office, period] = await Promise.all([officeById(text(b.cabang_id)), periodByKey(text(b.period))]);
  if (!office) return bad("cabang_id tidak dikenal.");
  if (!period) return bad("period tidak dikenal (format YYYY-MM).");

  const db = supabaseClosingAdmin();
  const { data: r, error: rErr } = await db.from("bot_reminder_requests").select("id,trigger,done_at,cancelled_at,skip_reason")
    .eq("id", request_id).eq("cabang_id", office.id).eq("period_id", period.id).maybeSingle();
  if (rErr) throw new Error(`Gagal baca permintaan: ${rErr.message}`);
  if (!r) return bad("request_id tidak ditemukan untuk kantor & periode ini.", 404);
  // Sudah ditutup (terkirim, dilewati, atau dibatalkan) → tidak diubah, dikembalikan apa adanya.
  if (r.done_at || r.cancelled_at) return json({ status: "ok", duplicate: true, closed: r.cancelled_at ? "cancelled" : r.skip_reason ? "skipped" : "sent" });

  const skip_reason = note ? `${reason}: ${note}` : reason;
  const { data: upd, error } = await db.from("bot_reminder_requests").update({ done_at: new Date().toISOString(), skip_reason })
    .eq("id", r.id).is("done_at", null).is("cancelled_at", null).select("id");
  if (error) throw new Error(`Gagal menutup permintaan: ${error.message}`);
  if (!upd?.length) return json({ status: "ok", duplicate: true });
  await audit("bot_lewati", "bot_reminder_requests", r.id as string, { kantor: office.cabang_name, periode: text(b.period), jenis: r.trigger, alasan: skip_reason }, "bot WA");
  return json({ status: "ok", duplicate: false });
}
