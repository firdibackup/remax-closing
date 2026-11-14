// Cut-off periode (PLAN §6): laporan bulan X terbuka sampai tgl 3 bulan berikutnya 23:59 WIB, lalu terkunci otomatis.
// Superadmin yang membuka kunci menetapkan batas baru di cutoff_at.
export type PeriodLike = { year: number; month: number; status: string; cutoff_at: string | null };

const CUTOFF_DAY = 3;
const CUTOFF_UTC_HOUR = 16; // 23:59 WIB = 16:59 UTC
const CUTOFF_MINUTE = 59;

export function defaultCutoff(year: number, month: number): string {
  return new Date(Date.UTC(month === 12 ? year + 1 : year, month % 12, CUTOFF_DAY, CUTOFF_UTC_HOUR, CUTOFF_MINUTE)).toISOString();
}

export const cutoffOf = (p: PeriodLike): string => p.cutoff_at ?? defaultCutoff(p.year, p.month);

// Boleh input/ubah: status terbuka dan belum lewat cut-off.
export const isWritable = (p: PeriodLike, now: Date = new Date()): boolean =>
  p.status === "open" && new Date(cutoffOf(p)).getTime() > now.getTime();

// Nilai <input type="datetime-local"> ("2026-11-20T23:59") dibaca sebagai WIB.
export function parseWibLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const d = new Date(`${value}:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

const WIB_OFFSET_MS = 7 * 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Belum mulai: sebelum tanggal 1 bulan itu (WIB). Tidak boleh diisi walau status di DB "open".
export const isFuture = (p: PeriodLike, now: Date = new Date()): boolean =>
  now.getTime() < Date.UTC(p.year, p.month - 1, 1) - WIB_OFFSET_MS;

// Boleh input baru (Genius/Excel/Nihil): sudah mulai dan belum lewat cut-off.
export const isInputOpen = (p: PeriodLike, now: Date = new Date()): boolean => !isFuture(p, now) && isWritable(p, now);

export type PeriodState = "open" | "locked" | "future";
export const periodState = (p: PeriodLike, now: Date = new Date()): PeriodState =>
  isFuture(p, now) ? "future" : isWritable(p, now) ? "open" : "locked";

export function countdown(p: PeriodLike, now: Date = new Date()): { days: number; hours: number } | null {
  const ms = new Date(cutoffOf(p)).getTime() - now.getTime();
  if (ms <= 0) return null;
  return { days: Math.floor(ms / DAY_MS), hours: Math.floor((ms % DAY_MS) / HOUR_MS) };
}

// Periode kerja default (list urut tahun, bulan): yang masih terbuka dengan cut-off terdekat;
// kalau semua terkunci, bulan terakhir yang sudah mulai.
export function defaultPeriod<T extends PeriodLike>(list: T[], now: Date = new Date()): T | undefined {
  const started = list.filter((p) => !isFuture(p, now));
  return started.find((p) => isWritable(p, now)) ?? started.at(-1);
}
