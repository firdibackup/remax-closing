import { test } from "node:test";
import assert from "node:assert/strict";
import { fitFontSize, geniusPhotoUrls, posterMonth, posterName, posterOffice } from "./format.ts";

test("teks bulan poster", () => {
  assert.equal(posterMonth(10, 2026), "OKTOBER 2026");
  assert.equal(posterMonth(1, 2027), "JANUARI 2027");
});

test("nama panggilan master jadi huruf kapital di awal kata", () => {
  assert.equal(posterName("REINA TAN"), "Reina Tan");
  assert.equal(posterName("  ella   handoko "), "Ella Handoko");
  assert.equal(posterName("ESTHER KARDIANA S.PSI"), "Esther Kardiana S.Psi");
  assert.equal(posterName("O'NEIL LIM-TAN"), "O'Neil Lim-Tan");
});

test("kantor poster dari office induk", () => {
  assert.equal(posterOffice("PREMIER"), "REMAX Premier");
  assert.equal(posterOffice("GREEN_HOUSE"), "REMAX Green House");
  assert.equal(posterOffice("MURYO PALEM"), "REMAX Muryo Palem");
  assert.equal(posterOffice("_360"), "REMAX 360");
});

test("font dikecilkan hanya kalau teks melebihi lebar maksimal", () => {
  const widthAt = (n: number) => (size: number) => n * size * 0.6; // n huruf, lebar huruf 0,6 em
  assert.equal(fitFontSize(80, 820, widthAt(10)), 80); // 480 px, muat
  const s = fitFontSize(80, 820, widthAt(30)); // 1440 px → ±45,5
  assert.ok(s < 80 && widthAt(30)(s) <= 820, `ukuran ${s}`);
  assert.equal(s, 45.5);
});

test("URL foto Genius S3 dialihkan ke host file Genius", () => {
  assert.deepEqual(geniusPhotoUrls("https://remax-files-pr0d.s3.ap-southeast-1.amazonaws.com/remax/profiles/a.jpeg"), [
    "https://akses.file.di.awanku.net/remax-files-pr0d/remax/profiles/a.jpeg",
    "https://remax-files-pr0d.s3.ap-southeast-1.amazonaws.com/remax/profiles/a.jpeg",
  ]);
  assert.deepEqual(geniusPhotoUrls("https://akses.file.di.awanku.net/remax-files-pr0d/remax/profiles/b.png"), ["https://akses.file.di.awanku.net/remax-files-pr0d/remax/profiles/b.png"]);
  assert.deepEqual(geniusPhotoUrls(null), []);
  assert.deepEqual(geniusPhotoUrls("bukan-url"), []);
});
