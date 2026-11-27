import assert from "node:assert/strict";
import { test } from "node:test";
import { fmt, rupiah } from "./number-format.ts";

test("nominal laporan menampilkan rupiah utuh serta sen jika ada", () => {
  assert.equal(rupiah(1500000), "Rp1.500.000");
  assert.equal(rupiah(1500001.25), "Rp1.500.001,25");
  assert.equal(fmt(-0.75), "-0,75");
  assert.equal(rupiah(1234567890123.45), "Rp1.234.567.890.123,45");
  assert.equal(rupiah(0), "Rp0");
});
