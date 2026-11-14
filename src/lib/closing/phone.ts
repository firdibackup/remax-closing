// Nomor kontak kantor (PLAN §7a.1): disimpan +62…, valid 9–15 digit; dipakai tombol WhatsApp & Telepon.
const MIN_DIGITS = 9;
const MAX_DIGITS = 15;

// Satu sel bisa berisi dua nomor ("0812… / 0813…"); yang dipakai nomor pertama.
export function normalizePhone(raw: string | null | undefined): string | null {
  const first = (raw ?? "").split(/[/,;]/)[0];
  const digits = first.replace(/\D/g, "");
  const national = (digits.startsWith("62") ? digits.slice(2) : digits).replace(/^0+/, "");
  const full = `62${national}`;
  return national && full.length >= MIN_DIGITS && full.length <= MAX_DIGITS ? `+${full}` : null;
}

export const waLink = (phone: string) => `https://wa.me/${phone.replace(/\D/g, "")}`;
export const telLink = (phone: string) => `tel:${phone}`;
