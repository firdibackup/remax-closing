"use server";

import { refreshAll } from "@/lib/closing/cache";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit, fail, ok, str, type ActionResult } from "@/lib/closing/audit";

// Pengaturan reminder WA bot (halaman Periode & Cut-off). Hermes membacanya lewat GET /api/bot/reminders/due.
const DRIVE_RX = /^https:\/\/drive\.google\.com\//;

export async function saveBotSettings(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const days = [...new Set(str(fd, "send_days").split(/[\s,;]+/).filter(Boolean).map(Number))];
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 31)) return fail("Tanggal kirim harus angka 1–31, dipisah koma (mis. 25, 1, 3).");
  const hour = Number(str(fd, "send_hour"));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return fail("Jam kirim harus 0–23 (WIB).");
  const drive = str(fd, "drive_url") || null;
  if (drive && !DRIVE_RX.test(drive)) return fail("Link folder harus link Google Drive (https://drive.google.com/…).");
  const row = { active: fd.get("active") === "on", send_days: days, send_hour: hour, drive_url: drive, updated_at: new Date().toISOString() };
  const { error } = await supabaseClosingAdmin().from("bot_settings").upsert({ id: true, ...row });
  if (error) return fail(`Gagal menyimpan: ${error.message}`);
  await audit("bot_pengaturan", "bot_settings", null, { aktif: row.active, tanggal: days.join(","), jam: hour, drive: drive ?? "—" });
  refreshAll();
  return ok(row.active ? "Pengaturan disimpan. Bot mengirim reminder sesuai jadwal." : "Pengaturan disimpan. Bot nonaktif.");
}
