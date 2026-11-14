import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClosingText, parseCodes } from "./codes.ts";

test("Closing ID dari teks WhatsApp: dobel, invoice, dan teks tak terbaca", () => {
  const text = "1. C26F21018/0092 - I26F21018/0090\nc26f31001/0170\nC26F21018/0092\nC26F2101 0093";
  const r = parseClosingText(text);
  assert.deepEqual(r.codes, ["C26F21018/0092", "C26F31001/0170"]);
  assert.deepEqual(r.dup, ["C26F21018/0092"]);
  assert.equal(r.invoices, 1);
  assert.deepEqual(r.bad, ["C26F21010093"]);
  assert.deepEqual(parseCodes(text), r.codes);
});

test("teks kosong", () => {
  assert.deepEqual(parseClosingText(""), { codes: [], dup: [], bad: [], invoices: 0 });
});
