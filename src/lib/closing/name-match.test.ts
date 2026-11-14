import { test } from "node:test";
import assert from "node:assert/strict";
import { nameScore, suggestAgents } from "./name-match.ts";

test("salah ketik ringan dan singkatan dianggap mirip", () => {
  assert.ok(nameScore("Linawati", "LINAWATY") >= 0.8);
  assert.ok(nameScore("Cass Wijaya", "CASSANDRA ETANIA WIJAYA") >= 0.8);
  assert.ok(nameScore("grace agustine", "GRACE AGUSTINE WIJAYA") >= 0.8);
});

test("nama berbeda tidak disarankan", () => {
  assert.ok(nameScore("Budi Santoso", "LINAWATY") < 0.8);
  assert.ok(nameScore("Andi", "ANITA") < 0.8);
});

test("saran: paling mirip dulu, agen kantor ini didahulukan, maksimal 3", () => {
  const list = [
    { id: "lain", names: ["LINAWATY"], local: false },
    { id: "sini", names: ["LINAWATY"], local: true },
    { id: "jauh", names: ["BUDI SANTOSO"], local: true },
  ];
  assert.deepEqual(suggestAgents("Linawati", list).map((s) => s.id), ["sini", "lain"]);
  assert.deepEqual(suggestAgents("", list), []);
});

test("saran: salah ketik berat tetap muncul untuk agen kantor ini saja", () => {
  const list = [
    { id: "sini", names: ["LINA", "LINAWATY LINAWATY"], local: true },
    { id: "lain", names: ["LINAWATY"], local: false },
    { id: "jauh", names: ["BUDI SANTOSO"], local: true },
  ];
  assert.deepEqual(suggestAgents("Liniwatiii", list).map((s) => s.id), ["sini"]);
});
