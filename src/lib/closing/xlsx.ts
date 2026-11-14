import "server-only";

import ExcelJS from "exceljs";
import { BULAN } from "@/components/ui";
import { KATEGORI_RATES } from "@/lib/closing/calc";
import type { Cell } from "@/lib/closing/excel-rows";
import { kategoriOf, type LineRow } from "@/lib/supabase/fetch-lines";
import type { GcRow } from "@/lib/closing/rekap";

// Ekspor .xlsx seperti template (PLAN §9 no. 4 & 6) dan pembaca file upload kantor (no. 9).
const MONEY_FMT = "#,##0";
const DATE_FMT = "d mmmm yyyy";
const RATE_FMT = "0.0%";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F2" } };
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const n = (v: number | string | null | undefined) => Number(v) || 0;
const dateCell = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);
const total = (rows: LineRow[], k: keyof LineRow) => rows.reduce((a, r) => a + n(r[k] as number), 0);

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  row.eachCell((c) => { c.fill = HEADER_FILL; c.border = { bottom: { style: "thin" } }; });
}

// Sheet "Perhitungan Komisi" (template kantor, kolom A–AA): judul, tarif B5/B6, judul kolom baris 10, rumus R–AA.
const KOMISI_HEADER_ROW = 10;
const KOMISI_FIRST_ROW = KOMISI_HEADER_ROW + 1;
const KOMISI_HEADERS = [
  "No", "Tanggal Transaksi", "Office", "Pembayaran Via", "Plafon (Jika KPR)", "RES / COMM", "Solo/Cobroke", "P / S / R", "L/S/LS", "MA",
  "Nama KTP MA (Belum Terdaftar)", "Nilai Transaksi\n(Gross)", "Alamat Properti dan keterangan", "Kantor Cobroke", "MA Cobroke", "Komisi %", "Komisi Gross",
  "Royalti\n(A x Royalti)", "PPN\n(B x 11%)", "PPh 23\n(B x 15%)", "Total Royalti\n(B + C -D)", "SSDF\n(A x SSDF)", "PPN\n(F x 11%)", "PPh 23\n(F x 2%)",
  "Total SSDF\n(F + G-H)", "Pembayaran ke RMI\n(E + I)", "Net Komisi\n=A - (B + C + F + G)",
];
// Rumus template; hasilnya diisi nilai tersimpan supaya file langsung terbaca sebelum Excel menghitung ulang.
const KOMISI_FORMULAS: [keyof LineRow, (r: number) => string][] = [
  ["royalti", (r) => `ROUND(Q${r}*$B$5,0)`], ["ppn_royalti", (r) => `ROUND(R${r}*11%,0)`], ["pph_royalti", (r) => `ROUND(R${r}*15%,0)`],
  ["total_royalti", (r) => `R${r}+S${r}-T${r}`], ["ssdf", (r) => `ROUND(Q${r}*$B$6,0)`], ["ppn_ssdf", (r) => `ROUND(V${r}*11%,0)`],
  ["pph_ssdf", (r) => `ROUND(V${r}*2%,0)`], ["total_ssdf", (r) => `V${r}+W${r}-X${r}`], ["ke_rmi", (r) => `U${r}+Y${r}`],
  ["net_komisi", (r) => `Q${r}-(R${r}+S${r}+V${r}+W${r})`],
];
const KOMISI_SUMS: [string, keyof LineRow][] = [
  ["L", "nilai_transaksi"], ["Q", "komisi_gross"], ["R", "royalti"], ["S", "ppn_royalti"], ["T", "pph_royalti"], ["U", "total_royalti"],
  ["V", "ssdf"], ["W", "ppn_ssdf"], ["X", "pph_ssdf"], ["Y", "total_ssdf"], ["Z", "ke_rmi"], ["AA", "net_komisi"],
];
const KOMISI_WIDTHS = [5, 16, 20, 18, 14, 10, 12, 8, 8, 22, 18, 16, 34, 18, 18, 9, 14, 12, 11, 11, 12, 12, 11, 11, 12, 14, 14];
const LETTER_COL_Q = 17;

function addKomisiSheet(wb: ExcelJS.Workbook, kat: "3.5" | "9", rows: LineRow[], title: string, periodLabel: string) {
  const ws = wb.addWorksheet(kat === "9" ? "9%" : "3,5%", { views: [{ state: "frozen", ySplit: KOMISI_HEADER_ROW }] });
  const [royalty, ssdf] = KATEGORI_RATES[kat];
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 13 };
  ws.getCell("A2").value = `LAPORAN KOMISI ${kat === "9" ? "9%" : "3,5%"} + PPN`;
  ws.getCell("A3").value = `PERHITUNGAN KOMISI PERIODE BULAN ${periodLabel}`;
  ws.getCell("A5").value = "Royalti";
  ws.getCell("B5").value = royalty;
  ws.getCell("A6").value = "SSDF";
  ws.getCell("B6").value = ssdf;
  ws.getCell("A7").value = "Total";
  ws.getCell("B7").value = { formula: "B5+B6", result: royalty + ssdf };
  "ABCDEFGHIJK".split("").forEach((letter, i) => { ws.getCell(9, LETTER_COL_Q + i).value = letter; });
  ws.getRow(KOMISI_HEADER_ROW).values = KOMISI_HEADERS;
  styleHeader(ws.getRow(KOMISI_HEADER_ROW));

  rows.forEach((l, i) => {
    const r = KOMISI_FIRST_ROW + i;
    ws.getRow(r).values = [
      i + 1, dateCell(l.tanggal_transaksi), l.offices?.cabang_name ?? "", l.bayar_via ?? "", l.plafond_kpr == null ? null : n(l.plafond_kpr),
      l.res_comm ?? "", l.solo_cobroke ?? "", l.psr ?? "", l.lsl ?? "", l.ma_name ?? "", null, n(l.nilai_transaksi), l.alamat ?? "",
      l.kantor_cobroke ?? "", l.ma_cobroke ?? "", l.komisi_pct == null ? null : n(l.komisi_pct), n(l.komisi_gross),
      ...KOMISI_FORMULAS.map(([k, f]) => ({ formula: f(r), result: n(l[k] as number) })),
    ];
  });
  const totalRow = KOMISI_FIRST_ROW + rows.length;
  const lastData = Math.max(totalRow - 1, KOMISI_FIRST_ROW);
  ws.getCell(`A${totalRow}`).value = "TOTAL";
  for (const [c, k] of KOMISI_SUMS) ws.getCell(`${c}${totalRow}`).value = { formula: `SUM(${c}${KOMISI_FIRST_ROW}:${c}${lastData})`, result: total(rows, k) };
  ws.getRow(totalRow).font = { bold: true };

  KOMISI_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.getColumn(2).numFmt = DATE_FMT;
  for (const c of ["E", ...KOMISI_SUMS.map(([col]) => col)]) ws.getColumn(c).numFmt = MONEY_FMT;
  ws.getColumn("P").numFmt = RATE_FMT;
  // Setelah format kolom B (tanggal), supaya sel tarif B5–B7 tidak ikut tampil sebagai tanggal.
  for (const a of ["B5", "B6", "B7"]) ws.getCell(a).numFmt = RATE_FMT;
}

// Laporan Bulanan: satu sheet per kategori (3,5% dan 9%), sesuai tab di halaman.
export function laporanWorkbook(rows: LineRow[], o: { month: number; year: number; cab?: string }): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "REMAX HQ Reporting Closing";
  const label = `${BULAN[o.month - 1]} ${o.year}`;
  for (const kat of ["3.5", "9"] as const) addKomisiSheet(wb, kat, rows.filter((r) => kategoriOf(r) === kat), o.cab ?? "REMAX HQ · Semua kantor", label);
  return wb;
}

// Data 2026: kolom A–AA sheet "2026" di Master Data (judul di baris 2, data mulai baris 3).
const DATA_HEADERS = [
  "Month", "Office Name", "REMAX", "Bayar Via", "Plafond (Jika KPR)", "COMM/RES", "Solo/Cobroke", "P/S/R", "L/S/LS", "Unit Listing", "Komisi Listing",
  "Unit Selling", "Komisi Selling", "MA", "Transaksi", "Total Komisi", "Royalti", "PPN", "SSDF", "PPN", "PPh Royalti", "PPh SSDF", "ke RMI", "Net Komisi",
  "Alamat Properti dan keterangan", "Kantor Cobroke", "MA Cobroke", "Closing ID", "Invoice ID", "Sumber",
];
const DATA_HEADER_ROW = 2;
// Closing ID / Invoice ID / Sumber ditambahkan di ujung (AB–AD) supaya huruf kolom sheet 2026 & rumusnya tetap.
const DATA_WIDTHS = [11, 16, 22, 18, 14, 10, 12, 7, 7, 8, 14, 8, 14, 24, 15, 14, 12, 11, 12, 11, 11, 11, 13, 14, 34, 18, 18, 18, 18, 10];
// Komisi Listing / Selling: LS dibagi dua, L/2L penuh ke listing, S/2S penuh ke selling (rumus sheet 2026).
const sideShare = (lsl: string | null, side: "L" | "S", gross: number) => (lsl === "LS" ? gross / 2 : lsl === side || lsl === `2${side}` ? gross : 0);

export function data2026Workbook(rows: LineRow[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "REMAX HQ Reporting Closing";
  const ws = wb.addWorksheet("2026", { views: [{ state: "frozen", ySplit: DATA_HEADER_ROW }] });
  ws.getRow(DATA_HEADER_ROW).values = DATA_HEADERS;
  styleHeader(ws.getRow(DATA_HEADER_ROW));
  rows.forEach((l, i) => {
    const r = DATA_HEADER_ROW + 1 + i;
    const gross = n(l.komisi_gross);
    ws.getRow(r).values = [
      BULAN[(l.periods?.month ?? 1) - 1].toUpperCase(), l.offices?.induk_name ?? "", l.offices?.cabang_name ?? "", l.bayar_via ?? "",
      l.plafond_kpr == null ? null : n(l.plafond_kpr), l.res_comm ?? "", l.solo_cobroke ?? "", l.psr ?? "", l.lsl ?? "", null,
      { formula: `IF(OR(I${r}="LS",I${r}="L",I${r}="2L"),IF(I${r}="LS",P${r}/2,P${r}),0)`, result: sideShare(l.lsl, "L", gross) }, null,
      { formula: `IF(OR(I${r}="LS",I${r}="S",I${r}="2S"),IF(I${r}="LS",P${r}/2,P${r}),0)`, result: sideShare(l.lsl, "S", gross) },
      l.ma_name ?? "", n(l.nilai_transaksi), gross, n(l.royalti), n(l.ppn_royalti), n(l.ssdf), n(l.ppn_ssdf), n(l.pph_royalti), n(l.pph_ssdf),
      n(l.ke_rmi), n(l.net_komisi), l.alamat ?? "", l.kantor_cobroke ?? "", l.ma_cobroke ?? "",
      l.closing_code ?? "", l.invoice_number ?? "", l.source,
    ];
  });
  DATA_WIDTHS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (const c of ["E", "K", "M", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X"]) ws.getColumn(c).numFmt = MONEY_FMT;
  return wb;
}

// GC Office: No | Office | Januari..Desember | Grand Total (sheet "GC Office 2026").
export function gcWorkbook(rows: GcRow[], year: number): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "REMAX HQ Reporting Closing";
  const ws = wb.addWorksheet(`GC Office ${year}`, { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] });
  ws.getRow(1).values = ["No", "Office", ...BULAN, "Grand Total"];
  styleHeader(ws.getRow(1));
  rows.forEach((r, i) => { ws.getRow(i + 2).values = [i + 1, r.induk, ...r.series, r.total]; });
  const t = ws.getRow(rows.length + 2);
  t.values = ["", "TOTAL", ...BULAN.map((_, m) => rows.reduce((a, r) => a + r.series[m], 0)), rows.reduce((a, r) => a + r.total, 0)];
  t.font = { bold: true };
  ws.getColumn(2).width = 22;
  for (let c = 3; c <= BULAN.length + 3; c++) { ws.getColumn(c).width = 15; ws.getColumn(c).numFmt = MONEY_FMT; }
  return wb;
}

export async function xlsxResponse(wb: ExcelJS.Workbook, filename: string): Promise<Response> {
  const buf = await wb.xlsx.writeBuffer();
  const ascii = filename.replace(/[^\x20-\x7E]/g, "").replace(/"/g, "");
  return new Response(buf as ArrayBuffer, {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}

// Isi sel sheet "Perhitungan Komisi" (atau sheet pertama) sebagai array per baris, untuk parseKomisiSheet.
export async function readKomisiRows(data: ArrayBuffer): Promise<Cell[][] | string> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch (e) {
    console.error("[upload] gagal membaca xlsx", e);
    return "File tidak bisa dibaca. Pastikan formatnya .xlsx (bukan .xls lama) dan tidak diproteksi password.";
  }
  const ws = wb.getWorksheet("Perhitungan Komisi") ?? wb.worksheets[0];
  if (!ws) return "File tidak berisi sheet.";
  const rows: Cell[][] = Array.from({ length: ws.rowCount }, () => []);
  ws.eachRow({ includeEmpty: false }, (row, i) => {
    rows[i - 1] = Array.from({ length: ws.columnCount }, (_, c) => cellOf(row.getCell(c + 1).value));
  });
  return rows;
}

function cellOf(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if ("result" in v) return cellOf((v.result ?? null) as ExcelJS.CellValue); // rumus: pakai hasil tersimpan
  if ("richText" in v) return v.richText.map((t) => t.text).join("");
  if ("text" in v) return String(v.text); // hyperlink
  return null; // sel error (#N/A dll.)
}
