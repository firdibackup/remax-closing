"use server";

import { refreshAll } from "@/lib/closing/cache";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit, fail, ok, str, type ActionResult } from "@/lib/closing/audit";
import { loadBotSettings } from "@/lib/bot/data";
import { isInputOpen, type PeriodLike } from "@/lib/closing/periods";

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

// Beranda → "Ingatkan sekarang" (manual) atau "File tidak ada" (drive_missing, kantor Excel yang bilang sudah upload).
// Hanya mencatat antrean; Hermes mengambilnya lewat GET /api/bot/reminders/due (tiap 5 menit, 08–17 WIB).
const UUID_RX = /^[0-9a-f-]{36}$/i;
const MAX_REQUESTS_PER_DAY = 1; // per jenis permintaan per kantor

export async function requestReminder(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const period_id = str(fd, "period_id"), cabang_id = str(fd, "cabang_id"), trigger = str(fd, "trigger");
  if (!UUID_RX.test(period_id) || !UUID_RX.test(cabang_id)) return fail("Periode/kantor tidak valid.");
  if (trigger !== "manual" && trigger !== "drive_missing") return fail("Jenis permintaan tidak valid.");
  const db = supabaseClosingAdmin();
  const [{ data: p, error: pErr }, { data: o, error: oErr }, settings] = await Promise.all([
    db.from("periods").select("year,month,status,cutoff_at").eq("id", period_id).maybeSingle(),
    db.from("offices").select("cabang_name,report_channel").eq("id", cabang_id).maybeSingle(),
    loadBotSettings(),
  ]);
  if (pErr || oErr) return fail(`Gagal membaca data: ${(pErr ?? oErr)!.message}`);
  if (!p || !isInputOpen(p as PeriodLike)) return fail("Periode terkunci, lewat cut-off, atau belum mulai.");
  if (!o) return fail("Kantor tidak ditemukan.");
  if (!settings.active) return fail("Bot WA nonaktif. Aktifkan dulu di Periode & Cut-off.");
  if (trigger === "drive_missing" && o.report_channel !== "EXCEL") return fail("“File tidak ada” hanya untuk kantor Excel.");
  if (o.report_channel === "EXCEL" && !settings.drive_url) return fail("Link folder Google Drive belum diisi di Periode & Cut-off.");

  const { data: open, error: qErr } = await db.from("bot_reminder_requests").select("id,trigger").eq("period_id", period_id).eq("cabang_id", cabang_id)
    .neq("trigger", "schedule").is("done_at", null).is("cancelled_at", null).limit(1);
  if (qErr) return fail(`Gagal cek antrean: ${qErr.message}`);
  if (open?.length && open[0].trigger === trigger) return fail("Sudah ada permintaan yang menunggu dikirim bot.");
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { count, error: cErr } = await db.from("bot_reminder_requests").select("id", { count: "exact", head: true }).eq("cabang_id", cabang_id)
    .eq("trigger", trigger).not("done_at", "is", null).is("skip_reason", null).gte("done_at", since); // dilewati bot (tanpa WA) tidak dihitung
  if (cErr) return fail(`Gagal cek antrean: ${cErr.message}`);
  if ((count ?? 0) >= MAX_REQUESTS_PER_DAY) return fail("Permintaan yang sama sudah terkirim dalam 24 jam terakhir. Hubungi lewat WA manual bila mendesak.");

  // Permintaan lama yang belum terkirim diganti dengan yang baru (mis. manual → File tidak ada).
  if (open?.length) await db.from("bot_reminder_requests").update({ cancelled_at: new Date().toISOString(), cancel_reason: "diganti permintaan baru" }).eq("id", open[0].id);
  const { data: row, error } = await db.from("bot_reminder_requests").insert({ period_id, cabang_id, trigger }).select("id").single();
  if (error) return fail(`Gagal menyimpan: ${error.message}`);
  await audit(trigger === "manual" ? "bot_ingatkan" : "bot_file_tidak_ada", "bot_reminder_requests", row.id as string, { kantor: o.cabang_name });
  refreshAll();
  return ok(trigger === "manual"
    ? "Dicatat. Bot mengirim reminder dalam ±5 menit (jam kerja 08.00–17.00 WIB)."
    : "Dicatat. Status kembali Belum, dan bot meminta kantor mengunggah ulang dalam ±5 menit (jam kerja).");
}

// Batalkan permintaan yang belum diambil bot.
export async function cancelReminderRequest(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!UUID_RX.test(id)) return fail("Permintaan tidak valid.");
  const { data, error } = await supabaseClosingAdmin().from("bot_reminder_requests").update({ cancelled_at: new Date().toISOString(), cancel_reason: "dibatalkan HQ" })
    .eq("id", id).is("done_at", null).is("cancelled_at", null).select("id,trigger");
  if (error) return fail(`Gagal membatalkan: ${error.message}`);
  if (!data?.length) return fail("Permintaan sudah terkirim atau sudah dibatalkan.");
  await audit("bot_batal_kirim", "bot_reminder_requests", id, { jenis: data[0].trigger });
  refreshAll();
  return ok("Permintaan dibatalkan.");
}
