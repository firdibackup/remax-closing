import { test } from "node:test";
import assert from "node:assert/strict";
import { agentGroups } from "./sides.ts";

// agentKey = agen REMAX + kantornya; null = pihak luar (EXTERNAL).
const side = (kind: "listing" | "selling" | "co_listing" | "co_selling", agentKey: string | null) => ({ kind, agentKey });

test("agen sama di listing & selling → satu baris LS tanpa co-broke (C/0175, C/0190)", () => {
  const groups = agentGroups([side("listing", "A"), side("selling", "A")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].lsl, "LS");
  assert.equal(groups[0].members.length, 2);
  assert.equal(groups[0].other, null);
});

test("agen beda → baris L dan S, saling jadi MA cobroke (C/0170)", () => {
  const [l, s] = agentGroups([side("listing", "A"), side("selling", "B")]);
  assert.equal(l.lsl, "L");
  assert.equal(l.other?.agentKey, "B");
  assert.equal(s.lsl, "S");
  assert.equal(s.other?.agentKey, "A");
});

test("pihak luar tidak dapat baris, tapi tercatat sebagai cobroke", () => {
  const groups = agentGroups([side("listing", null), side("selling", "A")]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].lsl, "S");
  assert.equal(groups[0].other?.agentKey, null);
});

test("co-listing oleh agen yang sama tetap satu baris L", () => {
  const groups = agentGroups([side("listing", "A"), side("co_listing", "A"), side("selling", "B")]);
  assert.deepEqual(groups.map((g) => [g.lsl, g.members.length]), [["L", 2], ["S", 1]]);
});
