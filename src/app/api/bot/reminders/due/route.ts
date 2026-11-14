import { json, modeOf, unauthorized, type PeriodRec } from "@/lib/bot/api";
import { loadBotSettings } from "@/lib/bot/data";
import { geniusFilter, isSendTime, periodKey, pickRecipient, targetPeriod, wibParts } from "@/lib/bot/schedule";
import { loadContacts } from "@/lib/closing/contacts";
import { loadActiveOffices } from "@/lib/closing/period-data";
import { cutoffOf } from "@/lib/closing/periods";
import { supabaseClosingAdmin } from "@/lib/supabase/client";

// GET /api/bot/reminders/due: kantor yang perlu dikirimi reminder sekarang. Hermes memanggil ini tiap hari.
// Bukan hari/jam kirim atau tidak ada periode terbuka → offices kosong (alasan di "reason").
// ?preview=1 mengabaikan jadwal & "sudah dikirim hari ini" (untuk uji), tetap memakai periode tujuan.
export const dynamic = "force-dynamic";

const WIB_OFFSET_MS = 7 * 3_600_000;

export async function GET(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const preview = new URL(req.url).searchParams.get("preview") === "1";
  const now = new Date();
  const { date } = wibParts(now);
  const settings = await loadBotSettings();
  const db = supabaseClosingAdmin();

  const { data: periods, error: pErr } = await db.from("periods").select("id,year,month,status,cutoff_at").order("year").order("month");
  if (pErr) throw new Error(`Gagal baca periode: ${pErr.message}`);
  const period = targetPeriod((periods ?? []) as PeriodRec[], now);
  const base = {
    date, preview, active: settings.active, send_days: settings.send_days, send_hour: settings.send_hour,
    period: period ? periodKey(period) : null, cutoff_at: period ? cutoffOf(period) : null,
    genius_filter: period ? geniusFilter(period) : null,
  };
  if (!period) return json({ ...base, reason: "Tidak ada periode terbuka.", offices: [], skipped: [] });
  if (!preview && !isSendTime(settings, now)) {
    return json({ ...base, reason: settings.active ? "Bukan tanggal/jam kirim." : "Bot nonaktif di web.", offices: [], skipped: [] });
  }

  const startOfDayWib = new Date(Date.parse(`${date}T00:00:00Z`) - WIB_OFFSET_MS).toISOString();
  const [offices, contacts, lines, nihil, sentToday] = await Promise.all([
    loadActiveOffices(),
    loadContacts(),
    db.from("commission_lines").select("cabang_id").eq("period_id", period.id).is("batal_at", null).limit(10000),
    db.from("recon_status").select("cabang_id").eq("period_id", period.id).eq("status", "Nihil"),
    db.from("reminder_log").select("cabang_id").eq("period_id", period.id).gte("sent_at", startOfDayWib),
  ]);
  for (const r of [lines, nihil, sentToday]) if (r.error) throw new Error(r.error.message);
  const ids = (r: { data: { cabang_id: string }[] | null }) => new Set((r.data ?? []).map((x) => x.cabang_id));
  const reported = ids(lines), nihilIds = ids(nihil), sent = ids(sentToday);

  const out: unknown[] = [];
  const skipped: { cabang_id: string; cabang_name: string; reason: string }[] = [];
  for (const o of offices) {
    const mode = modeOf(o.report_channel);
    const skip = (reason: string) => skipped.push({ cabang_id: o.id, cabang_name: o.cabang_name, reason });
    if (nihilIds.has(o.id)) { skip("sudah ditandai Nihil"); continue; }
    // Kantor Excel dianggap selesai setelah file diunggah HQ. Kantor Genius tetap ikut walau sudah ada baris:
    // sisa closing yang belum dikonfirmasi diingatkan lagi (Hermes menyaring lewat /closings/status).
    if (mode === "excel" && reported.has(o.id)) { skip("file Excel sudah diunggah"); continue; }
    if (!preview && sent.has(o.id)) { skip("sudah dikirimi hari ini"); continue; }
    const to = pickRecipient(contacts.get(o.id) ?? []);
    if (!to) { skip("tidak ada nomor WA kontak"); continue; }
    out.push({
      cabang_id: o.id, office_code: o.office_code, cabang_name: o.cabang_name, induk_name: o.induk_name, mode,
      send_to: to.phone, contact_jenis: to.jenis, has_lines: reported.has(o.id),
      ...(mode === "excel" ? { drive_url: settings.drive_url } : {}),
    });
  }
  return json({ ...base, offices: out, skipped });
}
