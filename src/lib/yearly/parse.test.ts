import { test } from "node:test";
import assert from "node:assert/strict";
import { amountOf, arithmetic, monthOf, parseYearSheet, plafondOf, soloCobrokeOf, YEAR_HEADERS, yearOfSheet, type Cell } from "./parse.ts";

// Susunan meniru sheet "2025" Master Data: baris 1 kosong, judul di baris 2 mulai kolom B.
const HEADER: Cell[] = [null, ...YEAR_HEADERS];
const row = (month: Cell, cabang: string, ma: string | null, komisi: Cell, extra: Partial<Record<"solo" | "psr" | "lsl" | "comm" | "bayar" | "plafond", Cell>> = {}): Cell[] => [
  null, month, "_360", cabang, extra.bayar ?? "TUNAI/TRANSFER", extra.plafond ?? null, extra.comm ?? "RES", extra.solo ?? "Solo", extra.psr ?? "R", extra.lsl ?? "LS", ma,
  29_000_000, komisi, 7250, 798, 43500, 4785, 1088, 870, 54375, 1393667, "Taman Anggrek Residence STD-32i", null, null,
];

test("judul kolom dicari (kolom B baris 2), nilai kotor dinormalisasi", () => {
  const p = parseYearSheet("2025", [
    [], HEADER,
    row("MARET", "360 (MPS)", "Dewi Andriana", 1_450_000),
    row("JANUARY", "360 (MPS)", "TJONG CI LIN", 4_500_000, { solo: "cobroke", psr: "r", lsl: "ls", comm: "cOMM", bayar: "tuNAI/TRANSFER", plafond: "1,18M" }),
    row("DESEMBER ", "Fast_Rawamangun", "Cynthia", 900_000, { solo: "SOLO", plafond: "Like Gunawan" }),
  ]);
  assert.deepEqual(p.errors, []);
  assert.equal(p.year, 2025);
  assert.equal(p.rows.length, 3);
  const [a, b, c] = p.rows;
  assert.equal(a.row_no, 3);
  assert.equal(a.month, 3);
  assert.equal(a.induk_raw, "_360");
  assert.equal(a.cabang_raw, "360 (MPS)");
  assert.equal(a.komisi_gross, 1_450_000);
  assert.equal(a.nilai_transaksi, 29_000_000);
  assert.equal(a.file.royalti, 7250);
  assert.equal(a.file.ssdf, 43500);
  assert.equal(a.file.ke_rmi, 54375);
  assert.equal(b.month, 1);
  assert.deepEqual([b.solo_cobroke, b.psr, b.lsl, b.res_comm, b.bayar_via, b.plafond_kpr], ["Cobroke", "R", "LS", "COMM", "TUNAI/TRANSFER", 1_180_000_000]);
  assert.equal(c.month, 12);
  assert.equal(c.solo_cobroke, "Solo");
  assert.equal(c.plafond_kpr, null);
  assert.equal(c.file.plafond_raw, "Like Gunawan");
});

test("sheet 2026 (mulai kolom A) juga terbaca", () => {
  const p = parseYearSheet("2026", [[], [...YEAR_HEADERS], row("FEBRUARY", "PREMIER_JGC", "CYNTHIA TAN", 2_000_000).slice(1)]);
  assert.deepEqual(p.errors, []);
  assert.equal(p.rows[0].month, 2);
  assert.equal(p.rows[0].cabang_raw, "PREMIER_JGC");
});

test("MA kosong atau komisi ≤ 0 dilewati dan dihitung; baris kosong diabaikan", () => {
  const p = parseYearSheet("2025", [[], HEADER, row("MARET", "GROW", null, 1_000_000), row("MARET", "GROW", "NANCY", 0), row("MARET", "GROW", "NANCY", -5), row("MARET", "GROW", "-", 1_000), [], row("MEI", "GROW", "NANCY", 10)]);
  assert.equal(p.skipped, 4);
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0].month, 5);
});

test("bulan tak terbaca jadi error baris, bukan baris data", () => {
  const p = parseYearSheet("2025", [[], HEADER, row("BULAN?", "GROW", "NANCY", 1_000)]);
  assert.equal(p.rows.length, 0);
  assert.match(p.errors[0], /Baris 3: bulan “BULAN\?”/);
});

test("susunan kolom beda → ditolak dengan pesan kolom", () => {
  const bad = [...HEADER];
  bad[11] = "Nilai";
  const p = parseYearSheet("2025", [[], bad, row("MARET", "GROW", "NANCY", 1_000)]);
  assert.equal(p.rows.length, 0);
  assert.match(p.errors[0], /tidak sesuai template/);
  assert.match(p.errors[1], /Kolom ke-11 harus “Transaksi”, di file “Nilai”/);
  assert.match(parseYearSheet("Sheet1", [["x"]]).errors[0], /Baris judul kolom tidak ditemukan/);
});

test("nama sheet bukan tahun → year null + peringatan", () => {
  assert.equal(yearOfSheet(" 2025 "), 2025);
  assert.equal(yearOfSheet("Sheet1"), null);
  const p = parseYearSheet("Data", [[], HEADER, row("MARET", "GROW", "NANCY", 1_000)]);
  assert.equal(p.year, null);
  assert.equal(p.rows.length, 1);
  assert.match(p.errors.at(-1)!, /bukan tahun/);
});

test("normalisasi bulan, angka, solo/cobroke", () => {
  for (const [v, m] of [["JANUARY", 1], ["FEBRUARY", 2], ["DESEMBER ", 12], ["Agt", 8], ["OCT", 10], ["mei", 5], [7, 7], ["11", 11]] as [Cell, number][]) assert.equal(monthOf(v), m, String(v));
  assert.equal(monthOf("-"), null);
  assert.equal(amountOf("1,000,000,000"), 1_000_000_000);
  assert.equal(amountOf("7.700.000.000"), 7_700_000_000);
  assert.equal(amountOf("-"), null);
  assert.equal(plafondOf("850jt"), 850_000_000);
  assert.equal(plafondOf("1.1M"), 1_100_000_000);
  assert.equal(plafondOf("KPR"), null);
  assert.deepEqual(["solo", "Solo", "SOLO", "cobroke", "COBROKE", "Lainnya"].map(soloCobrokeOf), ["Solo", "Solo", "Solo", "Cobroke", "Cobroke", "Lainnya"]);
});

test("rumus angka tanpa hasil tersimpan dihitung (Total Komisi \"=4500000-625000\")", () => {
  assert.equal(arithmetic("4500000-625000"), 3_875_000);
  assert.equal(arithmetic("(1000+500)*2/3"), 1000);
  assert.equal(arithmetic("L5*0.005"), null);
  assert.equal(arithmetic("SUM(1,2)"), null);
});
