import "server-only";

import { supabaseClosingAdmin } from "@/lib/supabase/client";
import type { BotSettings } from "@/lib/bot/schedule";

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

export const isBotKeyConfigured = () => (process.env.BOT_API_KEY ?? "").length >= 24;
