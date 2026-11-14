import { test } from "node:test";
import assert from "node:assert/strict";
import { calcAmounts } from "./calc.ts";

// Angka acuan: sheet "Perhitungan Komisi" file kantor REMAX 360 Agustus 2026 (rumus Excel asli).
test("3,5%: baris 11 file REMAX 360 (komisi 12,5 jt)", () => {
  assert.deepEqual(calcAmounts(12_500_000, 0.005, 0.03), {
    komisi_gross: 12_500_000, royalti: 62_500, ppn_royalti: 6_875, pph_royalti: 9_375, total_royalti: 60_000,
    ssdf: 375_000, ppn_ssdf: 41_250, pph_ssdf: 7_500, total_ssdf: 408_750, ke_rmi: 468_750, net_komisi: 12_014_375,
  });
});

test("3,5%: baris 13 dan 14 file REMAX 360", () => {
  const r13 = calcAmounts(3_000_000, 0.005, 0.03);
  assert.equal(r13.total_royalti, 14_400);
  assert.equal(r13.total_ssdf, 98_100);
  assert.equal(r13.ke_rmi, 112_500);
  assert.equal(r13.net_komisi, 2_883_450);
  const r14 = calcAmounts(75_000_000, 0.005, 0.03);
  assert.equal(r14.ke_rmi, 2_812_500);
  assert.equal(r14.net_komisi, 72_086_250);
});

test("9%: royalti 1% + SSDF 8%", () => {
  assert.deepEqual(calcAmounts(10_000_000, 0.01, 0.08), {
    komisi_gross: 10_000_000, royalti: 100_000, ppn_royalti: 11_000, pph_royalti: 15_000, total_royalti: 96_000,
    ssdf: 800_000, ppn_ssdf: 88_000, pph_ssdf: 16_000, total_ssdf: 872_000, ke_rmi: 968_000, net_komisi: 9_001_000,
  });
});

test("pembulatan per langkah seperti ROUND(…,0) di template", () => {
  const r = calcAmounts(1_111_111, 0.005, 0.03);
  assert.equal(r.royalti, 5_556); // 5.555,555
  assert.equal(r.ppn_royalti, 611); // 611,16
  assert.equal(r.pph_royalti, 833); // 833,4
  assert.equal(r.ssdf, 33_333); // 33.333,33
  assert.equal(r.ppn_ssdf, 3_667); // 3.666,63
  assert.equal(r.pph_ssdf, 667); // 666,66
  assert.equal(r.net_komisi, 1_067_944);
});
