import { test } from "node:test";
import assert from "node:assert/strict";
import { dateOf, parseKomisiSheet, type Cell } from "./excel-rows.ts";

// Susunan meniru file kantor REMAX 360 Agustus 2026 (template A–AA), nilai disederhanakan.
const HEADER: Cell[] = ["No", "Tanggal Transaksi", "Office", "Pembayaran Via", "Plafon (Jika KPR)", "RES / COMM", "Solo/Cobroke", "P / S / R", "L/S/LS", "MA", "Nama KTP MA (Belum Terdaftar)", "Nilai Transaksi\n(Gross)", "Alamat Properti dan keterangan", "Kantor Cobroke", "MA Cobroke", "Komisi %", "Komisi Gross", "Royalti\n(A x Royalti)", "PPN\n(B x 11%)", "PPh 23\n(B x 15%)", "Total Royalti\n(B + C -D)", "SSDF\n(A x SSDF)"];
const sheet = (...data: Cell[][]): Cell[][] => [
  ["CV. CONTOH"], ["RE/MAX 360"], ["PERHITUNGAN KOMISI PERIODE BULAN Agustus 2026"], [],
  ["Royalti", 0.005], ["SSDF ", 0.03], ["Total", 0.035], [], [], HEADER, ...data,
];
const row = (no: number, ma: string | null, komisi: number | null, tanggal: Cell = 46177): Cell[] =>
  [no, ma ? tanggal : null, "_360", "TUNAI/TRANSFER", null, "COMM", "Solo", "R", "LS", ma, null, 500_000_000, "Ruko A1", null, null, null, komisi, komisi ? komisi * 0.005 : 0, 0, 0, 0, komisi ? komisi * 0.03 : 0];

test("baris data dibaca lewat judul kolom, tarif dari B5/B6", () => {
  const p = parseKomisiSheet(sheet(row(1, "Linawaty", 12_500_000), row(2, null, null), row(3, null, null)));
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.rates, { royalty: 0.005, ssdf: 0.03 });
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].row, 11);
  assert.equal(p.rows[0].ma_name, "Linawaty");
  assert.equal(p.rows[0].komisi_gross, 12_500_000);
  assert.equal(p.rows[0].tanggal, "2026-06-04");
  assert.equal(p.rows[0].royalti_file, 62_500);
  assert.equal(p.rows[0].lsl, "LS");
});

test("baris total (tanpa MA dan tanggal) dilewati, MA kosong bertanggal jadi error", () => {
  const total: Cell[] = ["Total", null, null, null, null, null, null, null, null, null, null, 0, null, null, null, null, 40_500_000];
  const p = parseKomisiSheet(sheet(row(1, "Linawaty", 12_500_000), total, [4, 46180, "_360", null, null, null, null, null, null, null, null, 0, null, null, null, null, 1_000_000]));
  assert.equal(p.rows.length, 1);
  assert.deepEqual(p.errors, ["Baris 13: MA kosong."]);
});

test("komisi 0 dengan MA terisi ditolak", () => {
  const p = parseKomisiSheet(sheet(row(1, "Linawaty", 0)));
  assert.deepEqual(p.errors, ["Baris 11 (Linawaty): Komisi Gross kosong atau 0."]);
});

test("file tanpa judul Komisi Gross ditolak", () => {
  assert.match(parseKomisiSheet([["No", "Nama"]]).errors[0], /Komisi Gross/);
});

test("tanggal: serial Excel, Date, dan teks bahasa Indonesia", () => {
  assert.equal(dateOf(46177), "2026-06-04");
  assert.equal(dateOf(new Date("2026-10-01T00:00:00Z")), "2026-10-01");
  assert.equal(dateOf("1 Oktober 2026"), "2026-10-01");
  assert.equal(dateOf("besok"), null);
});

test("tanggal teks hari/bulan/tahun; tanggal salah ketik tetap dibaca barisnya", () => {
  assert.equal(dateOf("10/7/2026"), "2026-07-10");
  assert.equal(dateOf("31/2/2026"), null);
  const p = parseKomisiSheet(sheet(row(5, "Linawaty", 15_000_000, "10/72026")));
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].tanggal, "2026-07-10");
  assert.equal(p.rows[0].tanggal_guessed, true);
  assert.equal(p.rows[0].tanggal_raw, "10/72026");
});

test("judul template: nama PT, kantor, dan periode dari A1–A3", () => {
  const p = parseKomisiSheet(sheet(row(1, "Linawaty", 12_500_000)));
  assert.deepEqual(p.meta, { company: "CV. CONTOH", office: "RE/MAX 360", title: "PERHITUNGAN KOMISI PERIODE BULAN Agustus 2026", month: 8, year: 2026 });
});

test("format tanggal yang biasa diketik kantor", () => {
  const cases: [Cell, string | null][] = [
    ["4 Juni 2026", "2026-06-04"], ["4 jun 26", "2026-06-04"], ["04-Jun-2026", "2026-06-04"], ["4-Agustus-2026", "2026-08-04"],
    ["4 Agt. 2026", "2026-08-04"], ["4 Ags 2026", "2026-08-04"], ["12 Okt 2026", "2026-10-12"], ["1 Des 2026", "2026-12-01"],
    ["June 4, 2026", "2026-06-04"], ["Juni 4 2026", "2026-06-04"], ["Senin, 4 Juni 2026", "2026-06-04"], ["4th June 2026", "2026-06-04"],
    ["04/06/2026", "2026-06-04"], ["4-6-2026", "2026-06-04"], ["4.6.26", "2026-06-04"], ["04 / 06 / 2026", "2026-06-04"],
    ["13/06/2026", "2026-06-13"], ["06/13/2026", "2026-06-13"], ["2026-06-04", "2026-06-04"], ["2026/6/4", "2026-06-04"],
    ["04/06/2026 10:30", "2026-06-04"], ["2026-06-04T00:00:00.000Z", "2026-06-04"], ["46177", "2026-06-04"], ["04062026", "2026-06-04"],
    [46177, "2026-06-04"], [new Date("2026-06-04T00:00:00Z"), "2026-06-04"],
    ["", null], ["besok", null], ["32/1/2026", null], ["4 Juni", null], [0, null],
  ];
  for (const [input, want] of cases) assert.equal(dateOf(input), want, String(input));
});
