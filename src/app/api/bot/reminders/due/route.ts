import { json, modeOf, unauthorized, type PeriodRec } from "@/lib/bot/api";
import { loadBotSettings, loadOfficeWaFlags, type ReminderRequest } from "@/lib/bot/data";
import { CLAIM_MINUTES, MAX_ATTEMPTS, geniusFilter, isCekDrive, isSendTime, periodKey, pickRecipient, requestState, targetPeriod, wibParts } from "@/lib/bot/schedule";
import { loadContacts } from "@/lib/closing/contacts";
import { loadActiveOffices } from "@/lib/closing/period-data";
import { cutoffOf } from "@/lib/closing/periods";
import { supabaseClosingAdmin } from "@/lib/supabase/client";

// GET /api/bot/reminders/due: kantor yang perlu dikirimi WA sekarang. Hermes memanggil ini tiap 1 menit.
// Isinya: reminder terjadwal (tanggal/jam di halaman Periode) dan permintaan HQ dari Beranda (Ingatkan sekarang /
// File tidak ada). Setiap kantor yang diberikan dicatat "sedang diambil" selama 2 menit supaya tidak terkirim dobel;
// Hermes menutupnya lewat POST /reminder-log atau /reminder-skip dengan request_id. Tidak ada yang perlu dikirim → offices kosong.
// ?preview=1 mengabaikan jadwal & tidak mengambil antrean (untuk uji).
export const dynamic = "force-dynamic";

const WIB_OFFSET_MS = 7 * 3_600_000;
type Trigger = ReminderRequest["trigger"];
type Req = Pick<ReminderRequest, "id" | "cabang_id" | "trigger" | "claimed_at" | "attempts" | "done_at" | "cancelled_at"> & { schedule_day: string | null };
const REQ_COLS = "id,cabang_id,trigger,schedule_day,claimed_at,attempts,done_at,cancelled_at";

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
  if (!preview && !settings.active) return json({ ...base, reason: "Bot nonaktif di web.", offices: [], skipped: [] });

  const scheduled = preview || isSendTime(settings, now);
  const startOfDayWib = new Date(Date.parse(`${date}T00:00:00Z`) - WIB_OFFSET_MS).toISOString();
  const [offices, contacts, lines, nihil, sentToday, flags, reqs] = await Promise.all([
    loadActiveOffices(),
    loadContacts(),
    db.from("commission_lines").select("cabang_id").eq("period_id", period.id).is("batal_at", null).limit(10000),
    db.from("recon_status").select("cabang_id").eq("period_id", period.id).eq("status", "Nihil"),
    db.from("reminder_log").select("cabang_id").eq("period_id", period.id).gte("sent_at", startOfDayWib),
    loadOfficeWaFlags(period.id),
    db.from("bot_reminder_requests").select(REQ_COLS).eq("period_id", period.id).is("done_at", null).is("cancelled_at", null).limit(5000),
  ]);
  for (const r of [lines, nihil, sentToday, reqs]) if (r.error) throw new Error(r.error.message);
  const ids = (r: { data: { cabang_id: string }[] | null }) => new Set((r.data ?? []).map((x) => x.cabang_id));
  const reported = ids(lines), nihilIds = ids(nihil), sent = ids(sentToday);
  // Permintaan HQ terbaru per kantor (manual / drive_missing) dan baris jadwal hari ini.
  const hqReq = new Map<string, Req>(), schedReq = new Map<string, Req>();
  for (const r of (reqs.data ?? []) as Req[]) {
    if (r.trigger === "schedule") { if (r.schedule_day === date) schedReq.set(r.cabang_id, r); }
    else if (!hqReq.has(r.cabang_id)) hqReq.set(r.cabang_id, r);
  }

  const cancel = async (r: Req, reason: string) => {
    const { error } = await db.from("bot_reminder_requests").update({ cancelled_at: now.toISOString(), cancel_reason: reason }).eq("id", r.id).is("done_at", null);
    if (error) throw new Error(`Gagal menutup permintaan: ${error.message}`);
  };

  type Pick = { o: (typeof offices)[number]; mode: "genius" | "excel"; to: { phone: string; jenis: string }; trigger: Trigger; req: Req | null; hasLines: boolean };
  const picks: Pick[] = [];
  const skipped: { cabang_id: string; cabang_name: string; reason: string }[] = [];
  const needSchedule: string[] = [];
  for (const o of offices) {
    const mode = modeOf(o.report_channel);
    const skip = (reason: string) => skipped.push({ cabang_id: o.id, cabang_name: o.cabang_name, reason });
    const hq = hqReq.get(o.id);
    const f = flags.get(o.id);
    const stop = nihilIds.has(o.id) ? "sudah ditandai Nihil"
      // Kantor Excel dianggap selesai setelah file diunggah HQ. Kantor Genius tetap ikut walau sudah ada baris:
      // sisa closing yang belum dikonfirmasi diingatkan lagi (Hermes menyaring lewat /closings/status).
      : mode === "excel" && reported.has(o.id) ? "file Excel sudah diunggah"
      : mode === "excel" && isCekDrive(f?.uploadedAt, f?.driveMissingAt, false) ? "sudah bilang upload ke Drive, menunggu HQ cek"
      : null;
    if (stop) { skip(stop); if (hq && !preview) await cancel(hq, stop); continue; }
    const to = pickRecipient(contacts.get(o.id) ?? []);
    if (!to) { skip("tidak ada nomor WA kontak"); continue; }

    if (hq) {
      const st = requestState(hq, now);
      if (preview || st === "ready") { picks.push({ o, mode, to, trigger: hq.trigger, req: hq, hasLines: reported.has(o.id) }); continue; }
      if (st === "exhausted") { await cancel(hq, `sudah ${MAX_ATTEMPTS}x diberikan ke bot tanpa laporan terkirim`); skip("bot tidak melapor terkirim, permintaan HQ dihentikan"); continue; }
      if (st === "claimed") { skip("sedang dikirim bot"); continue; }
    }
    if (!scheduled) continue;
    if (!preview && sent.has(o.id)) { skip("sudah dikirimi hari ini"); continue; }
    const sr = schedReq.get(o.id);
    if (preview) { picks.push({ o, mode, to, trigger: "schedule", req: null, hasLines: reported.has(o.id) }); continue; }
    if (!sr) { needSchedule.push(o.id); picks.push({ o, mode, to, trigger: "schedule", req: null, hasLines: reported.has(o.id) }); continue; }
    const st = requestState(sr, now);
    if (st === "ready") picks.push({ o, mode, to, trigger: "schedule", req: sr, hasLines: reported.has(o.id) });
    else skip(st === "claimed" ? "sedang dikirim bot" : `reminder hari ini sudah ${MAX_ATTEMPTS}x diberikan ke bot`);
  }

  // Baris jadwal hari ini dibuat sekali per kantor (unik per tanggal), lalu diambil seperti permintaan lain.
  if (needSchedule.length) {
    const { error } = await db.from("bot_reminder_requests").upsert(
      needSchedule.map((cabang_id) => ({ period_id: period.id, cabang_id, trigger: "schedule", schedule_day: date, requested_by: "jadwal" })),
      { onConflict: "period_id,cabang_id,schedule_day", ignoreDuplicates: true },
    );
    if (error) throw new Error(`Gagal mencatat jadwal: ${error.message}`);
    const { data, error: rErr } = await db.from("bot_reminder_requests").select(REQ_COLS).eq("period_id", period.id).eq("schedule_day", date).in("cabang_id", needSchedule);
    if (rErr) throw new Error(rErr.message);
    const by = new Map(((data ?? []) as Req[]).map((r) => [r.cabang_id, r]));
    for (const p of picks) if (!p.req && p.trigger === "schedule") p.req = by.get(p.o.id) ?? null;
  }

  // Ambil antrean: hanya berhasil kalau belum diambil pihak lain (attempts sama) → panggilan bersamaan tidak dobel.
  const claimBefore = new Date(now.getTime() - CLAIM_MINUTES * 60_000).toISOString();
  const out: unknown[] = [];
  for (const p of picks) {
    if (!preview) {
      const r = p.req;
      if (!r || requestState(r, now) !== "ready") continue;
      const { data, error } = await db.from("bot_reminder_requests").update({ claimed_at: now.toISOString(), attempts: r.attempts + 1 })
        .eq("id", r.id).eq("attempts", r.attempts).is("done_at", null).is("cancelled_at", null)
        .or(`claimed_at.is.null,claimed_at.lt.${claimBefore}`).select("id");
      if (error) throw new Error(`Gagal mengambil antrean: ${error.message}`);
      if (!data?.length) continue;
    }
    const f = flags.get(p.o.id);
    out.push({
      cabang_id: p.o.id, office_code: p.o.office_code, cabang_name: p.o.cabang_name, induk_name: p.o.induk_name, mode: p.mode,
      send_to: p.to.phone, contact_jenis: p.to.jenis, has_lines: p.hasLines,
      trigger: p.trigger, request_id: p.req?.id ?? null,
      ...(p.mode === "excel" ? { drive_url: settings.drive_url } : {}),
      ...(p.trigger === "drive_missing" ? { uploaded_reply_at: f?.uploadedAt ?? null } : {}),
    });
  }
  const reason = out.length ? undefined : scheduled ? "Tidak ada kantor yang perlu dikirimi." : "Bukan tanggal/jam kirim dan tidak ada permintaan dari HQ.";
  return json({ ...base, ...(reason ? { reason } : {}), offices: out, skipped });
}
