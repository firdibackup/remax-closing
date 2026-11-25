// Baca sheet Master Data tahunan (sheet "2025", "2026", …), murni: input = isi sel per baris (Cell[][]).
// Template sama tiap tahun: Month | Office Name | RE/MAX | Bayar Via | … | MA Cobroke. Baris judul dicari (bukan
// ditetapkan), karena sheet 2025 mulai di kolom B baris 2 sedangkan sheet 2026 di kolom A. Urutan kolom dicek
// lewat nama yang dinormalisasi; kalau tidak sama, file ditolak dengan pesan kolom mana yang beda.
import type { Cell } from "../closing/excel-rows.ts";

export type { Cell };

// Angka apa adanya di file (dipakai sebagai pembanding; nilai yang disimpan dihitung ulang dengan tarif kantor).
export type FileAmounts = {
  royalti: number | null; ppn_royalti: number | null; ssdf: number | null; ppn_ssdf: number | null;
  pph_royalti: number | null; pph_ssdf: number | null; ke_rmi: number | null; net_komisi: number | null;
  plafond_raw?: string; // isi kolom Plafond yang bukan angka ("Like Gunawan", "KPR")
};

export type YearRow = {
  row_no: number; // nomor baris di sheet (1-based)
  month: number; // 1–12
  induk_raw: string; // kolom Office Name (PREMIER)
  cabang_raw: string; // kolom RE/MAX (PREMIER_JGC); kosong → induk
  ma_raw: string;
  bayar_via: string;
  plafond_kpr: number | null;
  res_comm: string;
  solo_cobroke: string;
  psr: string;
  lsl: string;
  nilai_transaksi: number;
  komisi_gross: number;
  alamat: string;
  kantor_cobroke: string;
  ma_cobroke: string;
  file: FileAmounts;
};

export type YearSheet = { year: number | null; rows: YearRow[]; skipped: number; errors: string[] };

// Judul kolom template (urutan tetap). "PPN" muncul dua kali: setelah Royalti dan setelah SSDF.
export const YEAR_HEADERS = [
  "Month", "Office Name", "RE/MAX", "Bayar Via", "Plafond (Jika KPR)", "COMM/RES", "Solo/Cobroke", "P/S/R", "L/S/LS", "MA",
  "Transaksi", "Total Komisi", "Royalti", "PPN", "SSDF", "PPN", "PPh Royalti", "PPh SSDF", "ke RMI", "Net Komisi",
  "Alamat Properti dan keterangan", "Kantor Cobroke", "MA Cobroke",
] as const;
const HEADER_SCAN_ROWS = 20;
const MAX_ROW_ERRORS = 30;

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const HEADER_KEYS = YEAR_HEADERS.map(key);

export const text = (c: Cell) => (c instanceof Date ? c.toISOString().slice(0, 10) : c == null ? "" : String(c)).replace(/\s+/g, " ").trim();

// Tahun dari nama sheet ("2025", " 2025 "); null kalau bukan 4 angka.
export function yearOfSheet(name: string): number | null {
  const m = /^\s*(\d{4})\s*$/.exec(name);
  const y = m ? Number(m[1]) : NaN;
  return y >= 2000 && y <= 2100 ? y : null;
}

// Nama bulan Indonesia & Inggris, lengkap atau 3 huruf awal ("JANUARY", "DESEMBER ", "Agt", "Oct"); angka 1–12; tanggal.
const MONTHS: [RegExp, number][] = [
  [/^jan/, 1], [/^(feb|peb)/, 2], [/^mar/, 3], [/^apr/, 4], [/^(mei|may)/, 5], [/^jun/, 6], [/^jul/, 7],
  [/^(agu|ags|agt|aug)/, 8], [/^sep/, 9], [/^(okt|oct)/, 10], [/^(nov|nop)/, 11], [/^(des|dec)/, 12],
];
export function monthOf(c: Cell): number | null {
  if (c instanceof Date) return c.getUTCMonth() + 1;
  if (typeof c === "number") return Number.isInteger(c) && c >= 1 && c <= 12 ? c : null;
  const t = text(c).toLowerCase();
  if (/^\d{1,2}$/.test(t)) return monthOf(Number(t));
  return MONTHS.find(([rx]) => rx.test(t))?.[1] ?? null;
}

// Angka rupiah: 29000000, "1,000,000,000", "7.700.000.000", "Rp 1.500.000". Teks lain → null.
export function amountOf(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const t = text(c).replace(/^rp\.?\s*/i, "");
  if (!t || t === "-") return null;
  if (/^-?\d{1,3}([.,]\d{3})+$/.test(t)) return Number(t.replace(/[.,]/g, ""));
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

// Plafond KPR sering ditulis singkat: "1,18M" (miliar), "850jt" (juta). Selain angka → null (teks disimpan terpisah).
export function plafondOf(c: Cell): number | null {
  const t = text(c).toLowerCase().replace(/\s+/g, "");
  const m = /^(\d+(?:[.,]\d+)?)(m|jt)$/.exec(t);
  if (m) return Math.round(Number(m[1].replace(",", ".")) * (m[2] === "m" ? 1e9 : 1e6));
  return amountOf(c);
}

// Nilai kategori seragam: solo/SOLO → Solo, cobroke/COBROKE → Cobroke (lainnya apa adanya, mis. "Lainnya").
export function soloCobrokeOf(c: Cell): string {
  const t = text(c);
  const u = t.toUpperCase();
  return u === "SOLO" ? "Solo" : u === "COBROKE" ? "Cobroke" : t;
}
// RES/COMM, P/S/R, L/S/LS: huruf besar ("r" → "R", "ls" → "LS", "cOMM" → "COMM").
export const upperOf = (c: Cell) => text(c).toUpperCase();
// Bayar Via: "tuNAI/TRANSFER" → "TUNAI/TRANSFER"; "kpr/kta bca" → "KPR/KTA BCA"; lainnya apa adanya.
export function bayarViaOf(c: Cell): string {
  const t = text(c);
  const u = t.toUpperCase();
  return u === "TUNAI/TRANSFER" || u.startsWith("KPR/KTA") || u === "CICILAN DEVELOPER" ? u : t;
}

// Hitung rumus yang hanya berisi angka dan + - * / ( ). Rumus lain (referensi sel, fungsi) → null.
export function arithmetic(formula: string): number | null {
  const src = formula.replace(/\s+/g, "");
  if (!/^[\d.+\-*/()]+$/.test(src)) return null;
  let i = 0;
  const num = (): number => {
    if (src[i] === "(") { i++; const v = sum(); if (src[i++] !== ")") throw new Error(")"); return v; }
    if (src[i] === "-") { i++; return -num(); }
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) throw new Error("angka");
    i += m[0].length;
    return Number(m[0]);
  };
  const product = (): number => {
    let v = num();
    while (src[i] === "*" || src[i] === "/") { const op = src[i++]; const r = num(); v = op === "*" ? v * r : v / r; }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (src[i] === "+" || src[i] === "-") { const op = src[i++]; const r = product(); v = op === "+" ? v + r : v - r; }
    return v;
  };
  try {
    const v = sum();
    return i === src.length && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

// Nama berisi minimal satu huruf/angka ("-" atau "?" dianggap kosong).
const hasName = (s: string) => /[A-Za-z0-9]/.test(s);

function findHeader(rows: Cell[][]): { row: number; col: number } | null {
  for (let r = 0; r < Math.min(rows.length, HEADER_SCAN_ROWS); r++) {
    const cells = rows[r] ?? [];
    for (let c = 0; c < cells.length; c++) {
      if (key(text(cells[c] ?? null)) === HEADER_KEYS[0] && key(text(cells[c + 1] ?? null)) === HEADER_KEYS[1]) return { row: r, col: c };
    }
  }
  return null;
}

export function parseYearSheet(sheetName: string, rows: Cell[][]): YearSheet {
  const year = yearOfSheet(sheetName);
  const errors: string[] = [];
  const out: YearRow[] = [];
  const head = findHeader(rows);
  if (!head) return { year, rows: [], skipped: 0, errors: [`Baris judul kolom tidak ditemukan di sheet “${sheetName}” (dicari “Month” lalu “Office Name” di ${HEADER_SCAN_ROWS} baris pertama).`] };
  const hdr = rows[head.row];
  for (let i = 0; i < YEAR_HEADERS.length; i++) {
    const got = text(hdr[head.col + i] ?? null);
    if (key(got) !== HEADER_KEYS[i]) errors.push(`Kolom ke-${i + 1} harus “${YEAR_HEADERS[i]}”, di file “${got || "(kosong)"}”.`);
  }
  if (errors.length) return { year, rows: [], skipped: 0, errors: [`Susunan kolom sheet “${sheetName}” tidak sesuai template Master Data.`, ...errors] };

  let skipped = 0, rowErrors = 0;
  const rowError = (msg: string) => { rowErrors++; if (rowErrors <= MAX_ROW_ERRORS) errors.push(msg); };
  for (let r = head.row + 1; r < rows.length; r++) {
    const all = rows[r] ?? [];
    const cells = all.slice(head.col, head.col + YEAR_HEADERS.length);
    if (cells.every((c) => text(c ?? null) === "")) continue;
    const at = (i: number): Cell => cells[i] ?? null;
    const ma = text(at(9));
    const komisi = Math.round(amountOf(at(11)) ?? 0);
    if (!hasName(ma) || komisi <= 0) { skipped++; continue; }
    const rowNo = r + 1;
    const month = monthOf(at(0));
    const induk = text(at(1)), cabang = hasName(text(at(2))) ? text(at(2)) : hasName(induk) ? induk : "";
    if (!month) { rowError(`Baris ${rowNo}: bulan “${text(at(0)) || "(kosong)"}” tidak terbaca.`); continue; }
    if (!cabang) { rowError(`Baris ${rowNo}: nama kantor (Office Name / RE/MAX) kosong.`); continue; }
    const plafond = plafondOf(at(4));
    const plafondRaw = text(at(4));
    out.push({
      row_no: rowNo, month, induk_raw: induk, cabang_raw: cabang, ma_raw: ma,
      bayar_via: bayarViaOf(at(3)), plafond_kpr: plafond, res_comm: upperOf(at(5)), solo_cobroke: soloCobrokeOf(at(6)),
      psr: upperOf(at(7)), lsl: upperOf(at(8)), nilai_transaksi: Math.round(amountOf(at(10)) ?? 0), komisi_gross: komisi,
      alamat: text(at(20)), kantor_cobroke: text(at(21)), ma_cobroke: text(at(22)),
      file: {
        royalti: amountOf(at(12)), ppn_royalti: amountOf(at(13)), ssdf: amountOf(at(14)), ppn_ssdf: amountOf(at(15)),
        pph_royalti: amountOf(at(16)), pph_ssdf: amountOf(at(17)), ke_rmi: amountOf(at(18)), net_komisi: amountOf(at(19)),
        ...(plafond === null && plafondRaw && plafondRaw !== "-" ? { plafond_raw: plafondRaw } : {}),
      },
    });
  }
  if (rowErrors > MAX_ROW_ERRORS) errors.push(`… dan ${rowErrors - MAX_ROW_ERRORS} baris lain tidak terbaca.`);
  if (year === null) errors.push(`Nama sheet “${sheetName}” bukan tahun (mis. “2025”). Pilih tahunnya saat impor.`);
  return { year, rows: out, skipped, errors };
}
