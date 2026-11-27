import { test } from "node:test";
import assert from "node:assert/strict";
import { nextInstallment } from "./installment.ts";

// Contoh sintetis dua termin untuk alur C26F21005/0066. Urutan API bisa terbalik.
const invoices = [{ number: "INV-B", phase: 2 }, { number: "INV-A", phase: 1 }];
test("Oktober mengambil termin pertama, input ulang Oktober berhenti, Desember mengambil sisanya", () => {
  assert.equal(nextInstallment(invoices, new Set(), new Set()), "INV-A");
  const reported = new Set(["INV-A"]);
  assert.equal(nextInstallment(invoices, reported, reported), null);
  assert.equal(nextInstallment(invoices, reported, new Set()), "INV-B");
  assert.equal(nextInstallment(invoices, new Set(["INV-A", "INV-B"]), new Set()), null);
});

test("invoice tunggal tanpa nomor termin tetap bisa masuk", () => {
  assert.equal(nextInstallment([{ number: "INV", phase: null }], new Set(), new Set()), "INV");
  assert.equal(nextInstallment([], new Set(), new Set()), null);
});
