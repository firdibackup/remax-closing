import { test } from "node:test";
import assert from "node:assert/strict";
import { countdown, cutoffOf, defaultCutoff, defaultPeriod, isFuture, isWritable, parseWibLocal, periodState, pickYear, pickerPeriods, yearsOf } from "./periods.ts";

test("cut-off default: tgl 3 bulan berikutnya 23:59 WIB", () => {
  assert.equal(defaultCutoff(2026, 9), "2026-10-03T16:59:00.000Z");
  assert.equal(defaultCutoff(2026, 12), "2027-01-03T16:59:00.000Z");
});

test("periode terbuka bisa ditulis sampai cut-off, lalu tidak", () => {
  const okt = { year: 2026, month: 10, status: "open", cutoff_at: null };
  assert.equal(isWritable(okt, new Date("2026-11-03T16:58:00Z")), true);
  assert.equal(isWritable(okt, new Date("2026-11-03T17:00:00Z")), false);
  assert.equal(isWritable({ ...okt, status: "locked" }, new Date("2026-10-15T00:00:00Z")), false);
});

test("cutoff_at dari buka kunci menggantikan default", () => {
  const p = { year: 2026, month: 10, status: "open", cutoff_at: "2026-11-20T16:59:00.000Z" };
  assert.equal(cutoffOf(p), "2026-11-20T16:59:00.000Z");
  assert.equal(isWritable(p, new Date("2026-11-14T00:00:00Z")), true);
});

test("input datetime-local dibaca sebagai WIB", () => {
  assert.equal(parseWibLocal("2026-11-20T23:59"), "2026-11-20T16:59:00.000Z");
  assert.equal(parseWibLocal("20/11/2026"), null);
});

test("periode belum mulai, terbuka, terkunci", () => {
  const des = { year: 2026, month: 12, status: "open", cutoff_at: null };
  const nov = { year: 2026, month: 11, status: "open", cutoff_at: null };
  const now = new Date("2026-11-14T03:00:00Z");
  assert.equal(isFuture(des, now), true);
  assert.equal(periodState(des, now), "future");
  assert.equal(periodState(nov, now), "open");
  assert.equal(periodState({ ...nov, status: "locked" }, now), "locked");
  // 1 Des 00:30 WIB = 30 Nov 17:30 UTC: Desember sudah mulai
  assert.equal(isFuture(des, new Date("2026-11-30T17:30:00Z")), false);
});

test("sisa waktu menuju cut-off", () => {
  const okt = { year: 2026, month: 10, status: "open", cutoff_at: "2026-11-20T03:04:00Z" };
  assert.deepEqual(countdown(okt, new Date("2026-11-14T01:04:00Z")), { days: 6, hours: 2 });
  assert.equal(countdown(okt, new Date("2026-11-21T00:00:00Z")), null);
});

test("periode kerja default: cut-off terdekat yang masih terbuka, bukan bulan depan", () => {
  const now = new Date("2026-11-14T03:00:00Z");
  const list = [
    { year: 2026, month: 9, status: "locked", cutoff_at: null },
    { year: 2026, month: 10, status: "open", cutoff_at: "2026-11-20T03:04:00Z" },
    { year: 2026, month: 11, status: "open", cutoff_at: null },
    { year: 2026, month: 12, status: "open", cutoff_at: null },
  ];
  assert.equal(defaultPeriod(list, now)?.month, 10);
  assert.equal(defaultPeriod(list.filter((p) => p.month !== 10), now)?.month, 11);
  assert.equal(defaultPeriod(list.slice(0, 1), now)?.month, 9);
  assert.equal(defaultPeriod([], now), undefined);
});

test("pilihan tahun: ?tahun= yang punya periode, selain itu tahun terakhir yang sudah mulai", () => {
  const now = new Date("2026-11-14T03:00:00Z");
  const p = (year: number, month: number, status = "locked") => ({ year, month, status, cutoff_at: null });
  const list = [p(2025, 1), p(2025, 12), p(2026, 1), p(2026, 11, "open"), p(2027, 1, "open")];
  assert.deepEqual(yearsOf(list), [2027, 2026, 2025]);
  assert.equal(pickYear("2025", list, now), 2025);
  assert.equal(pickYear("2027", list, now), 2027); // boleh dipilih walau belum mulai
  assert.equal(pickYear(undefined, list, now), 2026); // 2027 belum mulai → bukan default
  assert.equal(pickYear("2024", list, now), 2026);
  assert.equal(pickYear("abc", list, now), 2026);
  assert.equal(pickYear("2025.5", list, now), 2026);
  assert.equal(pickYear(undefined, [p(2027, 1, "open")], now), 2027); // semua belum mulai → tahun periode
  assert.equal(pickYear(undefined, [], now), 2026);
});

test("pilihan periode Input/Upload: tanpa periode terkunci tahun lalu", () => {
  const now = new Date("2026-11-14T03:00:00Z");
  const list = [
    { year: 2025, month: 12, status: "locked", cutoff_at: null },
    { year: 2025, month: 11, status: "open", cutoff_at: "2026-11-20T16:59:00.000Z" }, // dibuka kunci
    { year: 2026, month: 9, status: "locked", cutoff_at: null },
    { year: 2026, month: 11, status: "open", cutoff_at: null },
    { year: 2026, month: 12, status: "open", cutoff_at: null },
  ];
  assert.deepEqual(pickerPeriods(list, now).map((x) => `${x.year}-${x.month}`), ["2025-11", "2026-9", "2026-11"]);
});
