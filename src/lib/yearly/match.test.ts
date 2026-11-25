import { test } from "node:test";
import assert from "node:assert/strict";
import { agentIndex, inferKategori, maKey, matchOffice, officeKey } from "./match.ts";

const office = (id: string, cabang_name: string, induk_name: string, status = "aktif") => ({ id, cabang_name, induk_name, status });
const OFFICES = [
  office("rawa", "FAST_RAWAMANGUN", "FAST"), office("oak", "Fast_Oak_Tower", "FAST"), office("360", "_360", "_360"),
  office("tokyo", "RITZ_TOKYO", "RITZ"), office("jgc", "PREMIER_JGC", "PREMIER"), office("pik", "PREMIER_PIK", "PREMIER"),
  office("gs", "GOLDENSTAR", "GOLDENSTAR"), office("psm", "GOLDENSTAR (CV PSM)", "GOLDENSTAR"),
];

test("kantor: nama sama setelah normalisasi → otomatis", () => {
  assert.equal(officeKey("Fast_Rawamangun"), officeKey("FAST_RAWAMANGUN"));
  assert.equal(matchOffice("Fast_Rawamangun", OFFICES).auto?.id, "rawa");
  assert.equal(matchOffice("REMAX PREMIER_JGC", OFFICES).auto?.id, "jgc");
});

test("kantor: 360 (MPS)/(TSP) → _360 otomatis (keputusan HQ)", () => {
  assert.equal(matchOffice("360 (MPS)", OFFICES, "_360").auto?.id, "360");
  assert.equal(matchOffice("360 (TSP)", OFFICES, "_360").auto?.id, "360");
});

test("kantor tak dikenal: tidak otomatis, saran dari induk yang sama", () => {
  const m = matchOffice("RITZ", OFFICES, "RITZ");
  assert.equal(m.auto, null);
  assert.deepEqual(m.suggestions.map((o) => o.id), ["tokyo"]);
  const g = matchOffice("GOLDENSTAR (CV PSP)", OFFICES, "GOLDENSTAR");
  assert.equal(g.auto, null);
  assert.deepEqual(g.suggestions.map((o) => o.id).sort(), ["gs", "psm"]);
});

const agent = (id: string, name: string, full_name: string | null = null, aliases: string[] = []) => ({ id, name, full_name, sheet_name: full_name, aliases });
const AGENTS = [
  agent("tan", "CYNTHIA TAN", "CYNTHIA TAN"), agent("elisa", "ELISA", "ELISA ELISA"), agent("lina", "LINA", "LINAWATY LINAWATY"),
  agent("devi1", "DEVI", "DEVI"), agent("devi2", "DEVI", "DEVI ASMAN"), agent("devi3", "DEVI", "DEVIANTY HIDAYAT"),
  agent("nancy", "NANCY", "NANCY SOELISTIOWATI G"),
];
const LOCAL = new Map([["pik", new Set(["tan", "devi2"])], ["jgc", new Set(["devi1"])], ["360", new Set(["lina"])], ["indo", new Set(["elisa"])]]);

test("MA: nama persis satu agen → otomatis (nama lengkap, nama panggilan, huruf/spasi beda)", () => {
  const ix = agentIndex(AGENTS, LOCAL);
  assert.equal(ix.auto("grow", "NANCY SOELISTIOWATI G"), "nancy");
  assert.equal(ix.auto("grow", "nancy soelistiowati g."), "nancy");
  assert.equal(ix.auto("pik", "Cynthia Tan"), "tan");
  assert.equal(ix.auto("indo", "ELISA ELISA"), "elisa");
  assert.equal(maKey("Cynthia K. Wirjono"), "CYNTHIAKWIRJONO");
});

test("MA: nama dipakai beberapa agen → yang bertugas di kantor itu, kalau tidak ada → tidak otomatis", () => {
  const ix = agentIndex(AGENTS, LOCAL);
  assert.equal(ix.auto("jgc", "DEVI"), "devi1");
  assert.equal(ix.auto("pik", "DEVI"), "devi2");
  assert.equal(ix.auto("grow", "DEVI"), null);
});

test("MA mirip tapi tidak sama → saran, bukan otomatis", () => {
  const ix = agentIndex(AGENTS, LOCAL);
  assert.equal(ix.auto("pik", "Cynthia"), null);
  assert.equal(ix.suggest("pik", "Cynthia")[0]?.id, "tan");
  assert.equal(ix.suggest("pik", "Cynthia")[0]?.local, true);
  assert.equal(ix.auto("indo", "ELIS ELIS"), null);
  assert.equal(ix.suggest("indo", "ELIS ELIS")[0]?.id, "elisa");
  assert.equal(ix.auto("360", "LINDAWATY LINDAWATY"), null);
  assert.equal(ix.suggest("360", "LINDAWATY LINDAWATY")[0]?.id, "lina");
  assert.deepEqual(ix.suggest("grow", "BUDI SANTOSO"), []);
});

test("MA: nama kontak FO yang terhubung ke agen hanya berlaku di kantornya", () => {
  const ix = agentIndex(AGENTS, LOCAL, [{ office_id: "grow", agent_id: "nancy", nama: "Ibu Nancy S" }]);
  assert.equal(ix.auto("grow", "IBU NANCY S"), "nancy");
  assert.equal(ix.auto("pik", "IBU NANCY S"), null);
});

test("kategori kantor baru dari rasio royalti/komisi di file (suara terbanyak)", () => {
  const r = (komisi: number, royalti: number | null) => ({ komisi_gross: komisi, file: { royalti } });
  assert.equal(inferKategori([r(1_450_000, 7250), r(4_500_000, 22_500), r(1_000_000, 10_000)]), "3.5");
  assert.equal(inferKategori([r(2_916_650, 29_167), r(1_000_000, 10_000)]), "9");
  assert.equal(inferKategori([r(1_000_000, null), r(1_000_000, 123_456)]), null);
});
