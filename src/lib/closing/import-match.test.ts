import { test } from "node:test";
import assert from "node:assert/strict";
import { importDuplicateWarnings } from "./import-match.ts";

const imports = [{ cabang_id: "eagle", komisi_gross: "600000", ma_name: "WIDIA", year: 2026, month: 9 }];

test("flags preview line matching an imported row (same office, month, commission)", () => {
  const w = importDuplicateWarnings([{ cabang_id: "eagle", tanggal_transaksi: "2026-09-03", komisi_gross: 600000 }], imports);
  assert.equal(w.length, 1);
  assert.match(w[0], /09\/2026/);
  assert.match(w[0], /WIDIA/);
});

test("does not flag a different month or office", () => {
  assert.deepEqual(importDuplicateWarnings([{ cabang_id: "eagle", tanggal_transaksi: "2026-10-03", komisi_gross: 600000 }], imports), []);
  assert.deepEqual(importDuplicateWarnings([{ cabang_id: "mulyo", tanggal_transaksi: "2026-09-03", komisi_gross: 600000 }], imports), []);
});
