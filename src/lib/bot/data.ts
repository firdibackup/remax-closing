import "server-only";

import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { EXHAUSTED_REASON, MAX_ATTEMPTS, requestState, type BotSettings } from "@/lib/bot/schedule";

// Data bot WA yang dibaca halaman web (Periode, Rekon) dan API /api/bot/*.

export type ReminderRow = { cabang_id: string; mode: string; sent_at: string; sent_to: string | null; closing_codes: string[] };
export type ConfirmationRow = { cabang_id: string; kind: string; status: string; confirmed_codes: string[]; replied_at: string | null; created_at: string; result: { message?: string } };
export type BotActivity = { reminders: ReminderRow[]; confirmations: ConfirmationRow[] };

const DEFAULT_SETTINGS: BotSettings = { active: false, send_days: [25, 1, 3], send_hour: 9, drive_url: null };

export async function loadBotSettings(): Promise<BotSettings> {
  const { data, error } = await supabaseClosingAdmin().from("bot_settings").select("active,send_days,send_hour,drive_url").eq("id", true).maybeSingle();
  if (error) throw new Error(`Gagal baca pengaturan bot: ${error.message}`);
  return (data as BotSettings | null) ?? DEFAULT_SETTINGS;
}

// Riwayat reminder & balasan per kantor untuk satu periode, terbaru dulu.
export async function loadBotActivity(periodId: string): Promise<BotActivity> {
  const db = supabaseClosingAdmin();
  const [r, c] = await Promise.all([
    db.from("reminder_log").select("cabang_id,mode,sent_at,sent_to,closing_codes").eq("period_id", periodId).order("sent_at", { ascending: false }).limit(2000),
    db.from("bot_confirmations").select("cabang_id,kind,status,confirmed_codes,replied_at,created_at,result").eq("period_id", periodId).order("created_at", { ascending: false }).limit(2000),
  ]);
  if (r.error) throw new Error(`Gagal baca log reminder: ${r.error.message}`);
  if (c.error) throw new Error(`Gagal baca balasan bot: ${c.error.message}`);
  return { reminders: (r.data ?? []) as ReminderRow[], confirmations: (c.data ?? []) as ConfirmationRow[] };
}

// Ringkasan per kantor: reminder terakhir, jumlah reminder, dan balasan terakhir.
export type OfficeBotStatus = { lastReminder: ReminderRow | null; reminderCount: number; lastReply: ConfirmationRow | null };
export function botStatusByOffice(a: BotActivity): Map<string, OfficeBotStatus> {
  const out = new Map<string, OfficeBotStatus>();
  const get = (id: string) => out.get(id) ?? { lastReminder: null, reminderCount: 0, lastReply: null };
  for (const r of a.reminders) {
    const s = get(r.cabang_id);
    out.set(r.cabang_id, { ...s, lastReminder: s.lastReminder ?? r, reminderCount: s.reminderCount + 1 });
  }
  for (const c of a.confirmations) {
    const s = get(c.cabang_id);
    if (!s.lastReply) out.set(c.cabang_id, { ...s, lastReply: c });
  }
  return out;
}

// Closing dari balasan WA yang ditahan (agen/kantor belum di master) dan sampai sekarang belum tersimpan.
// Sudah tersimpan lewat Input atau balasan berikutnya → hilang dari daftar.
export type HeldClosing = { cabang_id: string; closing_code: string; reason: string; at: string };
export async function loadHeldClosings(periodId: string): Promise<HeldClosing[]> {
  const db = supabaseClosingAdmin();
  const { data, error } = await db.from("bot_confirmations").select("cabang_id,result,created_at")
    .eq("period_id", periodId).in("status", ["held", "partial"]).order("created_at", { ascending: false }).limit(2000);
  if (error) throw new Error(`Gagal baca closing ditahan: ${error.message}`);
  const latest = new Map<string, HeldClosing>();
  for (const c of (data ?? []) as { cabang_id: string; result: { held?: { closing_code: string; reason: string }[] }; created_at: string }[]) {
    for (const h of c.result?.held ?? []) {
      if (!latest.has(h.closing_code)) latest.set(h.closing_code, { cabang_id: c.cabang_id, closing_code: h.closing_code, reason: h.reason, at: c.created_at });
    }
  }
  if (!latest.size) return [];
  const { data: stored, error: sErr } = await db.from("commission_lines").select("closing_code").in("closing_code", [...latest.keys()]).is("batal_at", null);
  if (sErr) throw new Error(`Gagal cek closing tersimpan: ${sErr.message}`);
  for (const s of stored ?? []) latest.delete(s.closing_code as string);
  return [...latest.values()];
}

// Status WA per kantor untuk kartu Beranda: kapan admin bilang sudah upload ke Drive, kapan HQ menandai file tidak ada,
// permintaan kirim yang masih menunggu bot, dan reminder terakhir yang terkirim.
export type ReminderRequest = { id: string; cabang_id: string; trigger: "schedule" | "manual" | "drive_missing"; created_at: string; claimed_at: string | null; attempts: number; done_at: string | null; cancelled_at: string | null; cancel_reason: string | null };
// lastSkip: bot terakhir mengambil antrean kantor ini tapi tidak mengirim WA (alasan dari POST /reminder-skip).
// lastFailedAt: permintaan sudah MAX_ATTEMPTS kali diberikan ke bot tanpa laporan (terkirim / dilewati).
export type OfficeWaFlags = { uploadedAt: string | null; driveMissingAt: string | null; pending: ReminderRequest | null; lastSentAt: string | null; lastSkip: { at: string; reason: string } | null; lastFailedAt: string | null };
export async function loadOfficeWaFlags(periodId: string): Promise<Map<string, OfficeWaFlags>> {
  const db = supabaseClosingAdmin();
  const [c, q, r, k, x3] = await Promise.all([
    db.from("bot_confirmations").select("cabang_id,created_at").eq("period_id", periodId).eq("kind", "excel_uploaded").eq("status", "noted").order("created_at", { ascending: false }).limit(2000),
    db.from("bot_reminder_requests").select("id,cabang_id,trigger,created_at,claimed_at,attempts,done_at,cancelled_at,cancel_reason").eq("period_id", periodId).neq("trigger", "schedule").order("created_at", { ascending: false }).limit(2000),
    db.from("reminder_log").select("cabang_id,sent_at").eq("period_id", periodId).order("sent_at", { ascending: false }).limit(2000),
    db.from("bot_reminder_requests").select("cabang_id,done_at,skip_reason").eq("period_id", periodId).not("skip_reason", "is", null).order("done_at", { ascending: false }).limit(2000),
    db.from("bot_reminder_requests").select("cabang_id,claimed_at,attempts,done_at,cancelled_at,cancel_reason").eq("period_id", periodId).is("done_at", null).gte("attempts", MAX_ATTEMPTS).order("claimed_at", { ascending: false }).limit(2000),
  ]);
  for (const x of [c, q, r, k, x3]) if (x.error) throw new Error(`Gagal baca status WA: ${x.error.message}`);
  const out = new Map<string, OfficeWaFlags>();
  const get = (id: string) => out.get(id) ?? (out.set(id, { uploadedAt: null, driveMissingAt: null, pending: null, lastSentAt: null, lastSkip: null, lastFailedAt: null }).get(id) as OfficeWaFlags);
  for (const x of (c.data ?? []) as { cabang_id: string; created_at: string }[]) { const f = get(x.cabang_id); f.uploadedAt ??= x.created_at; }
  for (const x of (q.data ?? []) as ReminderRequest[]) {
    const f = get(x.cabang_id);
    if (x.trigger === "drive_missing" && !x.cancelled_at) f.driveMissingAt ??= x.created_at;
    if (!x.done_at && !x.cancelled_at) f.pending ??= x;
  }
  for (const x of (r.data ?? []) as { cabang_id: string; sent_at: string }[]) { const f = get(x.cabang_id); f.lastSentAt ??= x.sent_at; }
  for (const x of (k.data ?? []) as { cabang_id: string; done_at: string; skip_reason: string }[]) { const f = get(x.cabang_id); f.lastSkip ??= { at: x.done_at, reason: x.skip_reason }; }
  const now = new Date();
  type Tried = { cabang_id: string; claimed_at: string; attempts: number; done_at: null; cancelled_at: string | null; cancel_reason: string | null };
  for (const x of (x3.data ?? []) as Tried[]) {
    const failed = x.cancelled_at ? x.cancel_reason === EXHAUSTED_REASON : requestState(x, now) === "exhausted";
    if (failed) { const f = get(x.cabang_id); f.lastFailedAt ??= x.claimed_at; }
  }
  return out;
}

export const isBotKeyConfigured = () => (process.env.BOT_API_KEY ?? "").length >= 24;
