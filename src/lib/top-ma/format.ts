// Teks & URL untuk poster Top 10 MA. Murni (tanpa I/O), diuji di format.test.ts.

const BULAN_UPPER = ["JANUARI", "FEBRUARI", "MARET", "APRIL", "MEI", "JUNI", "JULI", "AGUSTUS", "SEPTEMBER", "OKTOBER", "NOVEMBER", "DESEMBER"];

// "OKTOBER 2026" (teks bulan di poster).
export const posterMonth = (month: number, year: number) => `${BULAN_UPPER[month - 1]} ${year}`;

// "REINA TAN" → "Reina Tan", "S.PSI" → "S.Psi" (huruf setelah spasi, titik, tanda hubung, apostrof, kurung jadi kapital).
export function titleCase(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/(^|[\s.\-'(])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

// Nama di poster: nama panggilan master (agents.name), huruf kapital di awal kata.
export const posterName = (masterName: string) => titleCase(masterName);

// Kantor di poster: "REMAX " + office induk. GREEN_HOUSE → Green House, _360 → 360.
export function posterOffice(induk: string): string {
  const words = induk.replace(/_/g, " ").trim();
  return `REMAX ${titleCase(words)}`.trim();
}

// Ukuran font supaya teks tidak melebihi lebar maksimal (aturan template: kecilkan sampai muat, tidak pernah diperbesar).
// widthAt(size) = lebar teks pada ukuran itu; lebar teks sebanding dengan ukuran font.
export function fitFontSize(base: number, maxWidth: number, widthAt: (size: number) => number): number {
  const w = widthAt(base);
  return w > maxWidth && w > 0 ? Math.floor(((base * maxWidth) / w) * 10) / 10 : base;
}

// Foto profil Genius: URL S3 langsung ditolak (403), berkas yang sama bisa diambil lewat host file Genius (awanku).
// Kembalikan URL yang dicoba berurutan; URL lain (sudah host awanku) dipakai apa adanya.
const S3_HOST = /^https?:\/\/(remax-files-pr0d)\.s3(?:\.[a-z0-9-]+)?\.amazonaws\.com\/(.+)$/i;
export function geniusPhotoUrls(url: string | null | undefined): string[] {
  const u = (url ?? "").trim();
  if (!/^https?:\/\//i.test(u)) return [];
  const m = S3_HOST.exec(u);
  return m ? [`https://akses.file.di.awanku.net/${m[1]}/${m[2]}`, u] : [u];
}
