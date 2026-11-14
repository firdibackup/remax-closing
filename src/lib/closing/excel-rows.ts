// Baca sheet "Perhitungan Komisi" dari kantor yang lapor via EXCEL (PLAN §9 no. 9).
// Baris judul dicari lewat teks "Komisi Gross"; kolom dipetakan dari teks judul, jadi template lama (A–Y)
// dan baru (A–AA, ada Plafon & Nama KTP MA) sama-sama terbaca. Murni: input = isi sel per baris.
export type Cell = string | number | boolean | Date | null;

export type ExcelRow = {
  row: number;
  tanggal: string | null; // ISO yyyy-mm-dd
  tanggal_raw: string; // isi sel apa adanya, untuk pesan kalau tanggal tidak terbaca / ditafsirkan
  tanggal_guessed: boolean; // tanggal hasil tafsiran salah ketik, perlu dicek
  office: string;
  bayar_via: string;
  plafond_kpr: number | null;
  res_comm: string;
  solo_cobroke: string;
  psr: string;
  lsl: string;
  ma_name: string;
  ma_ktp: string;
  nilai_transaksi: number;
  alamat: string;
  kantor_cobroke: string;
  ma_cobroke: string;
  komisi_pct: number | null;
  komisi_gross: number;
  royalti_file: number | null;
  ssdf_file: number | null;
  ke_rmi_file: number | null;
};

// Judul template: A1 nama PT, A2 nama kantor, A3 "PERHITUNGAN KOMISI PERIODE BULAN Agustus 2026".
export type SheetMeta = { company: string; office: string; title: string; month: number | null; year: number | null };
export type ParsedSheet = { rows: ExcelRow[]; errors: string[]; rates: { royalty: number | null; ssdf: number | null }; meta: SheetMeta };

type Key = Exclude<keyof ExcelRow, "row" | "tanggal_raw" | "tanggal_guessed">;
const COLUMNS: [Key, RegExp][] = [
  ["tanggal", /^tanggal/i], ["office", /^office$/i], ["bayar_via", /pembayaran via|bayar via/i], ["plafond_kpr", /^plafon/i],
  ["res_comm", /^(res\s*\/\s*comm|comm\s*\/\s*res)/i], ["solo_cobroke", /^solo/i], ["psr", /^p\s*\/\s*s\s*\/\s*r/i], ["lsl", /^l\s*\/\s*s/i],
  ["ma_name", /^ma$/i], ["ma_ktp", /nama ktp/i], ["nilai_transaksi", /^nilai transaksi/i], ["alamat", /^alamat/i],
  ["kantor_cobroke", /^kantor cobroke/i], ["ma_cobroke", /^ma cobroke/i], ["komisi_pct", /^komisi\s*%/i], ["komisi_gross", /^komisi gross/i],
  ["royalti_file", /^royalti/i], ["ssdf_file", /^ssdf/i], ["ke_rmi_file", /ke rmi/i],
];
const REQUIRED: Key[] = ["ma_name", "komisi_gross"];
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const BULAN = ["januari", "februari", "maret", "april", "mei", "juni", "juli", "agustus", "september", "oktober", "november", "desember"];

const text = (c: Cell) => (c instanceof Date ? c.toISOString().slice(0, 10) : c == null ? "" : String(c)).replace(/\s+/g, " ").trim();

function numberOf(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const t = text(c).replace(/^rp\.?\s*/i, "").replace(/\./g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// Nama bulan Indonesia & Inggris, lengkap atau singkatan (Agu/Ags/Aug, Okt/Oct, Des/Dec, Peb, Nop …).
const MONTH_NAMES: [RegExp, number][] = [
  [/^jan/, 0], [/^(feb|peb)/, 1], [/^mar/, 2], [/^apr/, 3], [/^(mei|may)/, 4], [/^jun/, 5], [/^jul/, 6],
  [/^(agu|ags|agt|aug)/, 7], [/^sep/, 8], [/^(okt|oct)/, 9], [/^(nov|nop)/, 10], [/^(des|dec)/, 11],
];
const monthOf = (w: string) => MONTH_NAMES.find(([rx]) => rx.test(w.toLowerCase()))?.[1] ?? -1;
const fullYear = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

function iso(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 0 || m > 11) return null;
  const t = new Date(Date.UTC(y, m, d));
  return t.getUTCMonth() === m && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
}

// Angka a/b/tahun: format Indonesia hari/bulan. Kalau angka pertama > 12 pasti hari; kalau angka kedua > 12 berarti
// ditulis bulan/hari (gaya Amerika).
function numeric(a: number, b: number, y: number): string | null {
  return b > 12 && a <= 12 ? iso(y, a - 1, b) : iso(y, b - 1, a);
}

export type ParsedDate = { iso: string | null; guessed: boolean };

// Kolom Tanggal Transaksi diisi bermacam-macam oleh kantor. Yang terbaca:
// sel tanggal Excel, serial Excel (46177), "4 Juni 2026", "4 Jun 26", "04-Jun-2026", "Juni 4, 2026", "Senin, 4 Juni 2026",
// "04/06/2026", "4-6-2026", "4.6.26", "2026-06-04", "04062026", plus jam di belakang ("04/06/2026 10:00").
// Salah ketik pemisah yang hilang ("10/72026") ditafsirkan dan ditandai guessed supaya dicek.
export function parseDate(c: Cell): ParsedDate {
  const ok = (v: string | null, guessed = false): ParsedDate => ({ iso: v, guessed: v ? guessed : false });
  if (c instanceof Date) return ok(Number.isNaN(c.getTime()) ? null : iso(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate()));
  if (typeof c === "number") return ok(c > 0 && c < 2_958_466 ? new Date(EXCEL_EPOCH_MS + Math.round(c) * DAY_MS).toISOString().slice(0, 10) : null);
  const t = text(c).toLowerCase()
    .replace(/^[a-z]+,\s*/, "") // nama hari "Senin, "
    .replace(/[t\s]\d{1,2}[:.]\d{2}([:.]\d{2})?(\.\d+)?(z|[+-]\d{2}:?\d{2})?$/, "") // jam di belakang
    .replace(/\s*(wib|wita|wit)$/, "")
    .trim();
  if (!t) return ok(null);
  // Serial Excel yang tersimpan sebagai teks.
  if (/^\d{5}$/.test(t)) return parseDate(Number(t));
  let m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(t);
  if (m) return ok(iso(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  m = /^(\d{1,2})\s*[/.-]\s*(\d{1,2})\s*[/.-]\s*(\d{2}|\d{4})$/.exec(t);
  if (m) return ok(numeric(Number(m[1]), Number(m[2]), fullYear(m[3])));
  // Hari + nama bulan + tahun: "4 juni 2026", "04-jun-26", "4 agt. 2026"
  m = /^(\d{1,2})(?:st|nd|rd|th)?[\s/.-]*([a-z]+)\.?[\s/.,-]*(\d{2}|\d{4})$/.exec(t);
  if (m && monthOf(m[2]) >= 0) return ok(iso(fullYear(m[3]), monthOf(m[2]), Number(m[1])));
  // Nama bulan + hari + tahun: "juni 4, 2026", "jun 04 2026"
  m = /^([a-z]+)\.?\s*(\d{1,2})(?:st|nd|rd|th)?[\s,]+(\d{4})$/.exec(t);
  if (m && monthOf(m[1]) >= 0) return ok(iso(Number(m[3]), monthOf(m[1]), Number(m[2])));
  // Tanpa pemisah: ddmmyyyy
  m = /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (m) return ok(iso(Number(m[3]), Number(m[2]) - 1, Number(m[1])), true);
  // Satu pemisah hilang: "10/72026" → 10/7/2026, "1007/2026" → 10/07/2026.
  m = /^(\d{1,2})[/.-](\d{1,2})(\d{4})$/.exec(t) ?? /^(\d{2})(\d{1,2})[/.-](\d{4})$/.exec(t);
  if (m) return ok(numeric(Number(m[1]), Number(m[2]), Number(m[3])), true);
  return ok(null);
}

export const dateOf = (c: Cell): string | null => parseDate(c).iso;

function metaOf(rows: Cell[][], before: number): SheetMeta {
  const firsts = rows.slice(0, before).map((cells) => text(cells[0] ?? null));
  const title = firsts.find((t) => /perhitungan komisi/i.test(t)) ?? "";
  const titleAt = firsts.indexOf(title);
  // Baris judul berisi nama PT dan kantor ada di atas judul perhitungan (template: A1, A2).
  const [company = "", office = ""] = titleAt > 0 ? firsts.slice(0, titleAt).filter(Boolean) : [];
  const m = /bulan\s+([a-z]+)\s+(\d{4})/i.exec(title);
  const month = m ? BULAN.indexOf(m[1].toLowerCase()) : -1;
  return { company, office, title, month: month >= 0 ? month + 1 : null, year: m ? Number(m[2]) : null };
}

function rateNear(rows: Cell[][], label: RegExp, before: number): number | null {
  const r = rows.slice(0, before).find((cells) => label.test(text(cells[0] ?? null)));
  return r ? numberOf(r[1] ?? null) : null;
}

export function parseKomisiSheet(rows: Cell[][]): ParsedSheet {
  const headerAt = rows.findIndex((cells) => cells.some((c) => /^komisi gross/i.test(text(c))));
  if (headerAt < 0) return { rows: [], errors: ["Judul kolom \"Komisi Gross\" tidak ditemukan. Pakai template Perhitungan Komisi."], rates: { royalty: null, ssdf: null }, meta: metaOf(rows, 10) };
  const header = rows[headerAt].map(text);
  const col = new Map<Key, number>();
  for (const [key, rx] of COLUMNS) {
    const i = header.findIndex((h) => rx.test(h));
    if (i >= 0) col.set(key, i);
  }
  const missing = REQUIRED.filter((k) => !col.has(k));
  const rates = { royalty: rateNear(rows, /^royalti$/i, headerAt), ssdf: rateNear(rows, /^ssdf$/i, headerAt) };
  const meta = metaOf(rows, headerAt);
  if (missing.length) return { rows: [], errors: [`Kolom wajib tidak ditemukan: ${missing.join(", ")}.`], rates, meta };

  const get = (cells: Cell[], k: Key): Cell => (col.has(k) ? cells[col.get(k)!] ?? null : null);
  const out: ExcelRow[] = [];
  const errors: string[] = [];
  rows.slice(headerAt + 1).forEach((cells, i) => {
    const row = headerAt + 2 + i; // nomor baris Excel (1-based)
    const ma = text(get(cells, "ma_name"));
    const komisi = numberOf(get(cells, "komisi_gross")) ?? 0;
    const tanggalCell = get(cells, "tanggal");
    const { iso: tanggal, guessed } = parseDate(tanggalCell);
    if (!ma && !(komisi > 0 && tanggalCell != null)) return; // baris kosong bernomor / baris total
    if (!ma) return void errors.push(`Baris ${row}: MA kosong.`);
    if (komisi <= 0) return void errors.push(`Baris ${row} (${ma}): Komisi Gross kosong atau 0.`);
    out.push({
      row, tanggal, tanggal_raw: text(tanggalCell), tanggal_guessed: guessed, office: text(get(cells, "office")), bayar_via: text(get(cells, "bayar_via")), plafond_kpr: numberOf(get(cells, "plafond_kpr")),
      res_comm: text(get(cells, "res_comm")), solo_cobroke: text(get(cells, "solo_cobroke")), psr: text(get(cells, "psr")), lsl: text(get(cells, "lsl")),
      ma_name: ma, ma_ktp: text(get(cells, "ma_ktp")), nilai_transaksi: numberOf(get(cells, "nilai_transaksi")) ?? 0, alamat: text(get(cells, "alamat")),
      kantor_cobroke: text(get(cells, "kantor_cobroke")), ma_cobroke: text(get(cells, "ma_cobroke")), komisi_pct: numberOf(get(cells, "komisi_pct")),
      komisi_gross: Math.round(komisi), royalti_file: numberOf(get(cells, "royalti_file")), ssdf_file: numberOf(get(cells, "ssdf_file")),
      ke_rmi_file: numberOf(get(cells, "ke_rmi_file")),
    });
  });
  if (!out.length && !errors.length) errors.push("Tidak ada baris transaksi (kolom MA dan Komisi Gross kosong semua).");
  return { rows: out, errors, rates, meta };
}
