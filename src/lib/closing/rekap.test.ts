import { test } from "node:test";
import assert from "node:assert/strict";
import { gcByInduk, rankMa, type RekapLine } from "./rekap.ts";

const line = (month: number, induk: string, ma: string, gc: number, agent_id: string | null = null, cabang = induk): RekapLine => ({
  komisi_gross: gc, ma_name: ma, agent_id, offices: { induk_name: induk, cabang_name: cabang }, periods: { id: `p${month}`, month, year: 2026, status: "locked" },
});

test("GC per office induk per bulan, urut nama", () => {
  const r = gcByInduk([line(1, "EAGLE", "A", 100), line(1, "EAGLE", "B", 50), line(3, "ALPHA", "C", "20" as unknown as number)]);
  assert.deepEqual(r.map((x) => x.induk), ["ALPHA", "EAGLE"]);
  assert.equal(r[1].series[0], 150);
  assert.equal(r[0].series[2], 20);
  assert.equal(r[1].total, 150);
});

test("Top MA: YTD vs bulan, filter office, agen pindah dijumlah semua kantor", () => {
  const rows = [line(1, "EAGLE", "Debby", 100, "a1"), line(2, "HARVEST", "DEBBY I", 70, "a1"), line(2, "EAGLE", "Budi", 120), line(2, "EAGLE", " budi ", 10)];
  const ytd = rankMa(rows, { month: 0 });
  assert.deepEqual(ytd.map((r) => [r.induk, r.gc, r.count]), [["EAGLE", 130, 2], ["EAGLE", 100, 1], ["HARVEST", 70, 1]]);
  assert.equal(ytd.find((r) => r.agentId === "a1")?.allOffices, 170);
  assert.deepEqual(rankMa(rows, { month: 2, ind: "EAGLE" }).map((r) => r.gc), [130]);
});
