// Pencocokan nama di Master Data tahunan ke master (murni, tanpa I/O): cabang → kantor, nama MA per kantor → agen.
// Otomatis hanya kalau pasti (nama sama persis setelah normalisasi dan hanya satu agen; kalau beberapa, yang
// pernah bertugas di kantor itu). Selain itu hanya saran nama mirip; HQ yang memilih di halaman Verifikasi.
import { KATEGORI_RATES } from "../closing/calc.ts";
import { normName, suggestAgents, type NameCandidate } from "../closing/name-match.ts";
import { officeCandidates, officeKey } from "./office-names.ts";
import type { FileAmounts } from "./parse.ts";

export { officeKey };
// Kunci nama MA (kunci agent_name_map): huruf besar, hanya huruf/angka ("Cynthia K. Wirjono" → "CYNTHIAKWIRJONO").
export const maKey = (name: string | null | undefined) => normName(name);

export type MatchOffice = { id: string; cabang_name: string; induk_name: string; status: string };
export type MatchAgent = { id: string; name: string; full_name: string | null; sheet_name: string | null; aliases: string[] | null };
// Nama-nama tambahan agen per kantor (kontak Franchise Owner yang terhubung ke agen: office_contacts.nama).
export type OfficeAgentNames = { office_id: string; agent_id: string; nama: string | null };

// Nama 360 (MPS)/(TSP) → _360 sudah diputuskan HQ, jadi langsung dipetakan; alias lain hanya saran.
const AUTO_ALIAS_KEYS = new Set(["360MPS", "360TSP"]);

export type OfficeMatch<T> = { auto: T | null; suggestions: T[] };

// Kantor untuk satu nama cabang di file. auto = satu kantor bernama sama persis (atau alias yang sudah diputuskan).
export function matchOffice<T extends MatchOffice>(cabangRaw: string, offices: T[], indukRaw = ""): OfficeMatch<T> {
  const { exact, alias } = officeCandidates(cabangRaw, offices);
  const key = officeKey(cabangRaw);
  const auto = exact.length === 1 ? exact[0] : !exact.length && alias.length === 1 && AUTO_ALIAS_KEYS.has(key) ? alias[0] : null;
  // Saran tambahan: kantor lain dengan induk yang sama ("RITZ" → RITZ_TOKYO), kantor aktif dulu.
  const ik = officeKey(indukRaw);
  const sameInduk = ik ? offices.filter((o) => officeKey(o.induk_name) === ik) : [];
  const seen = new Set<string>();
  const suggestions = [...exact, ...alias, ...sameInduk.sort((a, b) => Number(b.status === "aktif") - Number(a.status === "aktif") || a.cabang_name.localeCompare(b.cabang_name))]
    .filter((o) => !seen.has(o.id) && !!seen.add(o.id));
  return { auto, suggestions };
}

// Kategori kantor baru (historis) dari angka di file: royalti/komisi ≈ 0,5% → 3,5; ≈ 1% → 9. Suara terbanyak.
const RATE_TOLERANCE = 0.0015;
export function inferKategori(rows: { komisi_gross: number; file: Pick<FileAmounts, "royalti"> }[]): "3.5" | "9" | null {
  const votes: Record<"3.5" | "9", number> = { "3.5": 0, "9": 0 };
  for (const r of rows) {
    if (!r.komisi_gross || r.file.royalti == null) continue;
    const ratio = r.file.royalti / r.komisi_gross;
    for (const k of ["3.5", "9"] as const) if (Math.abs(ratio - KATEGORI_RATES[k][0]) <= RATE_TOLERANCE) votes[k]++;
  }
  if (!votes["3.5"] && !votes["9"]) return null;
  return votes["9"] > votes["3.5"] ? "9" : "3.5";
}

// Semua nama agen yang dicocokkan persis: nama, nama lengkap, nama laporan, alias, dan nama lengkap tanpa kata ganda
// ("LINAWATY LINAWATY" → "LINAWATY"), sama seperti upload Excel kantor.
export function agentNames(a: MatchAgent): string[] {
  const out = [a.name, a.full_name, a.sheet_name, ...(a.aliases ?? [])].filter((x): x is string => !!x);
  if (a.full_name) out.push([...new Set(a.full_name.trim().toUpperCase().split(/\s+/))].join(" "));
  return out;
}

export type AgentIndex = {
  // Agen yang namanya sama persis, atau null kalau tidak ada / ganda.
  auto(officeId: string, maRaw: string): string | null;
  // Saran nama mirip (maks. 3); local = pernah bertugas di kantor itu / kontak FO kantor itu.
  suggest(officeId: string, maRaw: string): { id: string; score: number; local: boolean }[];
};

// localByOffice: office_id → agent_id yang pernah bertugas di kantor itu (agent_assignments, tanggal berapa pun).
export function agentIndex(agents: MatchAgent[], localByOffice: Map<string, Set<string>>, extra: OfficeAgentNames[] = []): AgentIndex {
  const byKey = new Map<string, Set<string>>();
  const add = (k: string, id: string) => { if (k) byKey.set(k, (byKey.get(k) ?? new Set()).add(id)); };
  for (const a of agents) for (const n of agentNames(a)) add(maKey(n), a.id);
  // Nama kontak FO hanya berlaku di kantornya sendiri.
  const extraByOffice = new Map<string, Map<string, Set<string>>>();
  for (const x of extra) {
    const k = maKey(x.nama);
    if (!k) continue;
    const m = extraByOffice.get(x.office_id) ?? new Map<string, Set<string>>();
    m.set(k, (m.get(k) ?? new Set()).add(x.agent_id));
    extraByOffice.set(x.office_id, m);
  }
  const localOf = (officeId: string) => {
    const s = new Set(localByOffice.get(officeId) ?? []);
    for (const x of extra) if (x.office_id === officeId) s.add(x.agent_id);
    return s;
  };
  const candidatesCache = new Map<string, NameCandidate[]>();
  const candidates = (officeId: string) => {
    let c = candidatesCache.get(officeId);
    if (!c) {
      const local = localOf(officeId);
      const fo = extra.filter((x) => x.office_id === officeId);
      c = agents.map((a) => ({ id: a.id, names: [...agentNames(a), ...fo.filter((x) => x.agent_id === a.id).map((x) => x.nama)], local: local.has(a.id) }));
      candidatesCache.set(officeId, c);
    }
    return c;
  };
  return {
    auto(officeId, maRaw) {
      const k = maKey(maRaw);
      if (!k) return null;
      const hits = new Set([...(byKey.get(k) ?? []), ...(extraByOffice.get(officeId)?.get(k) ?? [])]);
      if (hits.size === 1) return [...hits][0];
      const local = localOf(officeId);
      const mine = [...hits].filter((id) => local.has(id));
      return mine.length === 1 ? mine[0] : null;
    },
    suggest(officeId, maRaw) {
      const list = candidates(officeId);
      return suggestAgents(maRaw, list).map((s) => ({ ...s, local: list.find((c) => c.id === s.id)?.local ?? false }));
    },
  };
}
