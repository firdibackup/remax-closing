// Jadwal reminder WA bot (murni, tanpa I/O). Web menentukan kapan kirim, periode tujuan, dan penerima;
// Hermes hanya mengeksekusi.
import { cutoffOf, periodState, type PeriodLike } from "../closing/periods.ts";
import { normalizePhone } from "../closing/phone.ts";

export type BotSettings = { active: boolean; send_days: number[]; send_hour: number; drive_url: string | null };
export type ContactLite = { jenis: string; phone: string | null; is_primary: boolean };

const WIB_OFFSET_MS = 7 * 3_600_000;

export function wibParts(now: Date): { date: string; day: number; hour: number } {
  const w = new Date(now.getTime() + WIB_OFFSET_MS);
  return { date: w.toISOString().slice(0, 10), day: w.getUTCDate(), hour: w.getUTCHours() };
}

// Hari kirim: bot aktif, tanggal WIB ada di daftar, dan sudah lewat jam kirim.
export function isSendTime(s: BotSettings, now: Date): boolean {
  const { day, hour } = wibParts(now);
  return s.active && s.send_days.includes(day) && hour >= s.send_hour;
}

// Periode tujuan: yang sudah mulai dan masih terbuka, dengan cut-off terdekat (dikendalikan dari halaman Periode).
export function targetPeriod<T extends PeriodLike>(list: T[], now: Date): T | undefined {
  return list
    .filter((p) => periodState(p, now) === "open")
    .sort((a, b) => Date.parse(cutoffOf(a)) - Date.parse(cutoffOf(b)) || a.year - b.year || a.month - b.month)[0];
}

const pad = (n: number) => String(n).padStart(2, "0");
export const periodKey = (p: { year: number; month: number }) => `${p.year}-${pad(p.month)}`;

// Rentang tanggal closing untuk GET /closings Genius (filterClosingDateStartAt/EndAt).
export function geniusFilter(p: { year: number; month: number }) {
  const last = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  return { filterClosingDateStartAt: `${periodKey(p)}-01`, filterClosingDateEndAt: `${periodKey(p)}-${pad(last)}` };
}

// Penerima: kontak utama; kalau tidak ada nomornya, Admin; lalu BO. Satu nomor saja.
export function pickRecipient(list: ContactLite[]): { phone: string; jenis: string } | null {
  const withPhone = list.flatMap((c) => {
    const phone = normalizePhone(c.phone);
    return phone ? [{ ...c, phone }] : [];
  });
  const c = withPhone.find((x) => x.is_primary) ?? withPhone.find((x) => x.jenis === "admin") ?? withPhone.find((x) => x.jenis === "bo") ?? withPhone[0];
  return c ? { phone: c.phone, jenis: c.jenis } : null;
}

// Kantor Excel yang membalas "sudah upload ke Drive" dan belum diimpor HQ → "Cek Drive".
// HQ klik "File tidak ada" setelah balasan itu → kembali Belum sampai admin membalas "sudah" lagi.
export function isCekDrive(uploadedAt: string | null | undefined, driveMissingAt: string | null | undefined, hasLines: boolean): boolean {
  if (hasLines || !uploadedAt) return false;
  return !driveMissingAt || Date.parse(uploadedAt) > Date.parse(driveMissingAt);
}

// Antrean kirim: permintaan diberikan ke Hermes, lalu tidak diberikan lagi selama CLAIM_MINUTES supaya tidak dobel
// walau Hermes bertanya tiap 5 menit. Sudah diberikan MAX_ATTEMPTS kali tanpa laporan terkirim → dihentikan.
export const CLAIM_MINUTES = 10;
// Permintaan dari HQ (Ingatkan sekarang / File tidak ada) hanya dikirim jam kerja WIB, supaya kantor tidak ditagih malam hari.
export const REQUEST_HOURS = { from: 8, to: 17 } as const;
export const inRequestHours = (now: Date) => { const { hour } = wibParts(now); return hour >= REQUEST_HOURS.from && hour < REQUEST_HOURS.to; };
export const MAX_ATTEMPTS = 3;
export type RequestLite = { claimed_at: string | null; attempts: number; done_at: string | null; cancelled_at: string | null };
export function requestState(r: RequestLite, now: Date): "ready" | "claimed" | "exhausted" | "closed" {
  if (r.done_at || r.cancelled_at) return "closed";
  if (r.claimed_at && now.getTime() - Date.parse(r.claimed_at) < CLAIM_MINUTES * 60_000) return "claimed";
  return r.attempts >= MAX_ATTEMPTS ? "exhausted" : "ready";
}

// Hermes mengambil antrean tapi tidak mengirim WA (POST /reminder-skip). Teks untuk kartu Beranda.
export const SKIP_REASONS = {
  no_outstanding_closings: "tidak ada closing outstanding",
  no_closings: "tidak ada closing di Genius",
  other: "tidak dikirim",
} as const;
export type SkipReason = keyof typeof SKIP_REASONS;
export const isSkipReason = (v: string): v is SkipReason => Object.hasOwn(SKIP_REASONS, v);
export const skipLabel = (stored: string | null | undefined): string => {
  const [code, ...note] = (stored ?? "").split(": ");
  return isSkipReason(code) ? (note.length ? `${SKIP_REASONS[code]} (${note.join(": ")})` : SKIP_REASONS[code]) : stored || SKIP_REASONS.other;
};

// Nomor pengirim balasan harus salah satu kontak kantor itu.
export const isOfficeContact = (list: ContactLite[], from: string | null | undefined): boolean => {
  const n = normalizePhone(from);
  return !!n && list.some((c) => normalizePhone(c.phone) === n);
};
