import "server-only";

import ExcelJS from "exceljs";
import { arithmetic, yearOfSheet, type Cell } from "@/lib/yearly/parse";

// Baca file Master Data tahunan: sheet yang namanya tahun ("2025"; kalau beberapa, tahun terbesar), atau sheet pertama.
// Rumus memakai hasil tersimpan di file (sama seperti pembaca upload kantor di lib/closing/xlsx.ts).
export type YearWorkbook = { sheet: string; sheets: string[]; rows: Cell[][] };

export async function readYearWorkbook(data: ArrayBuffer, sheetName?: string): Promise<YearWorkbook | string> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(data);
  } catch (e) {
    console.error("[impor tahunan] gagal membaca xlsx", e);
    return "File tidak bisa dibaca. Pastikan formatnya .xlsx (bukan .xls lama) dan tidak diproteksi password.";
  }
  const sheets = wb.worksheets.map((w) => w.name);
  const byYear = wb.worksheets.filter((w) => yearOfSheet(w.name) !== null).sort((a, b) => yearOfSheet(b.name)! - yearOfSheet(a.name)!);
  const ws = (sheetName ? wb.getWorksheet(sheetName) : undefined) ?? byYear[0] ?? wb.worksheets[0];
  if (!ws) return "File tidak berisi sheet.";
  if (sheetName && ws.name !== sheetName) return `Sheet “${sheetName}” tidak ada di file. Sheet: ${sheets.join(", ")}.`;
  const rows: Cell[][] = Array.from({ length: ws.rowCount }, () => []);
  ws.eachRow({ includeEmpty: false }, (row, i) => {
    rows[i - 1] = Array.from({ length: ws.columnCount }, (_, c) => cellOf(row.getCell(c + 1).value));
  });
  return { sheet: ws.name, sheets, rows };
}

function cellOf(v: ExcelJS.CellValue): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if ("result" in v && v.result !== undefined) return cellOf((v.result ?? null) as ExcelJS.CellValue); // rumus: pakai hasil tersimpan
  if ("formula" in v && typeof v.formula === "string") return arithmetic(v.formula); // rumus tanpa hasil tersimpan ("4500000-625000")
  if ("richText" in v) return v.richText.map((t) => t.text).join("");
  if ("text" in v) return String(v.text); // hyperlink
  return null; // sel error (#N/A dll.)
}
