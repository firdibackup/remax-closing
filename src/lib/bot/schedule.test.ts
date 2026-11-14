import { test } from "node:test";
import assert from "node:assert/strict";
import { geniusFilter, isCekDrive, isOfficeContact, isSendTime, pickRecipient, requestState, targetPeriod, wibParts } from "./schedule.ts";

const settings = { active: true, send_days: [25, 1, 3], send_hour: 9, drive_url: null };

test("jam & tanggal dibaca dalam WIB", () => {
  assert.deepEqual(wibParts(new Date("2026-10-24T17:30:00Z")), { date: "2026-10-25", day: 25, hour: 0 });
});

test("hari kirim: tanggal cocok, sudah lewat jam kirim, bot aktif", () => {
  assert.equal(isSendTime(settings, new Date("2026-10-25T02:00:00Z")), true); // 09:00 WIB
  assert.equal(isSendTime(settings, new Date("2026-10-25T01:59:00Z")), false); // 08:59 WIB
  assert.equal(isSendTime(settings, new Date("2026-10-26T03:00:00Z")), false);
  assert.equal(isSendTime({ ...settings, active: false }, new Date("2026-10-25T03:00:00Z")), false);
});

test("periode tujuan: terbuka dengan cut-off terdekat", () => {
  const list = [
    { year: 2026, month: 9, status: "locked", cutoff_at: null },
    { year: 2026, month: 10, status: "open", cutoff_at: null },
    { year: 2026, month: 11, status: "open", cutoff_at: null },
  ];
  assert.equal(targetPeriod(list, new Date("2026-10-25T03:00:00Z"))?.month, 10);
  assert.equal(targetPeriod(list, new Date("2026-11-01T03:00:00Z"))?.month, 10); // Okt masih sampai 3 Nov
  assert.equal(targetPeriod(list, new Date("2026-11-04T03:00:00Z"))?.month, 11);
  // September dibuka lagi sampai 10 Nov → cut-off terdekat, jadi fokus September.
  const reopened = [{ ...list[0], status: "open", cutoff_at: "2026-11-10T16:59:00.000Z" }, list[1], list[2]];
  assert.equal(targetPeriod(reopened, new Date("2026-11-05T03:00:00Z"))?.month, 9);
});

test("filter tanggal Genius satu bulan penuh", () => {
  assert.deepEqual(geniusFilter({ year: 2026, month: 2 }), { filterClosingDateStartAt: "2026-02-01", filterClosingDateEndAt: "2026-02-28" });
  assert.deepEqual(geniusFilter({ year: 2026, month: 10 }), { filterClosingDateStartAt: "2026-10-01", filterClosingDateEndAt: "2026-10-31" });
});

test("penerima: utama, lalu admin, lalu BO; satu nomor saja", () => {
  const admin = { jenis: "admin", phone: "0812-1111-2222", is_primary: false };
  const bo = { jenis: "bo", phone: "0813 3333 4444", is_primary: false };
  assert.deepEqual(pickRecipient([bo, admin]), { phone: "+6281211112222", jenis: "admin" });
  assert.deepEqual(pickRecipient([{ ...admin, phone: null }, bo]), { phone: "+6281333334444", jenis: "bo" });
  assert.deepEqual(pickRecipient([admin, { ...bo, is_primary: true }]), { phone: "+6281333334444", jenis: "bo" });
  assert.equal(pickRecipient([{ ...admin, phone: "" }]), null);
});

test("nomor pengirim dicocokkan ke kontak kantor", () => {
  const list = [{ jenis: "admin", phone: "0812-1111-2222", is_primary: true }];
  assert.equal(isOfficeContact(list, "6281211112222"), true);
  assert.equal(isOfficeContact(list, "+62 812 1111 2222"), true);
  assert.equal(isOfficeContact(list, "+6289999999999"), false);
});

test("Cek Drive: balasan sudah upload, belum diimpor, tidak dibatalkan HQ", () => {
  assert.equal(isCekDrive("2026-11-14T03:00:00Z", null, false), true);
  assert.equal(isCekDrive("2026-11-14T03:00:00Z", null, true), false); // sudah diimpor → Sudah lapor
  assert.equal(isCekDrive(null, null, false), false);
  assert.equal(isCekDrive("2026-11-14T03:00:00Z", "2026-11-14T04:00:00Z", false), false); // HQ: file tidak ada
  assert.equal(isCekDrive("2026-11-14T05:00:00Z", "2026-11-14T04:00:00Z", false), true); // admin balas sudah lagi
});

test("antrean kirim: diambil 10 menit, maksimal 3 kali", () => {
  const now = new Date("2026-11-14T03:00:00Z");
  const base = { claimed_at: null, attempts: 0, done_at: null, cancelled_at: null };
  assert.equal(requestState(base, now), "ready");
  assert.equal(requestState({ ...base, claimed_at: "2026-11-14T02:55:00Z", attempts: 1 }, now), "claimed");
  assert.equal(requestState({ ...base, claimed_at: "2026-11-14T02:49:00Z", attempts: 1 }, now), "ready");
  assert.equal(requestState({ ...base, claimed_at: "2026-11-14T02:49:00Z", attempts: 3 }, now), "exhausted");
  assert.equal(requestState({ ...base, done_at: "2026-11-14T02:56:00Z" }, now), "closed");
});
