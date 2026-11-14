import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, waLink } from "./phone.ts";

test("nomor HP dan kantor jadi +62…", () => {
  assert.equal(normalizePhone("0878-7600-0138"), "+6287876000138");
  assert.equal(normalizePhone("+62 31 123 4567"), "+62311234567");
  assert.equal(normalizePhone("62 (0)812 1111 2222"), "+6281211112222");
});

test("dua nomor dalam satu sel: ambil yang pertama", () => {
  assert.equal(normalizePhone("0812-1111-2222 / 0813-3333-4444"), "+6281211112222");
});

test("nomor terlalu pendek, terlalu panjang, atau kosong ditolak", () => {
  assert.equal(normalizePhone("123"), null);
  assert.equal(normalizePhone("0812345678901234"), null);
  assert.equal(normalizePhone(""), null);
  assert.equal(normalizePhone(null), null);
});

test("link WhatsApp tanpa tanda +", () => {
  assert.equal(waLink("+6287876000138"), "https://wa.me/6287876000138");
});
