// Saran nama agen yang mirip untuk nama MA di file Excel yang tidak cocok persis (murni, tanpa I/O).
// Hanya saran: HQ tetap memilih sendiri supaya komisi tidak masuk ke agen yang salah.

export const normName = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const tokens = (s: string | null | undefined) => (s ?? "").toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length > 1);

function lev(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

const ratio = (a: string, b: string) => (!a || !b ? 0 : 1 - lev(a, b) / Math.max(a.length, b.length));

// Kata di file dicocokkan ke kata nama agen: sama, salah ketik ringan, atau singkatan awal ("CASS" → "CASSANDRA").
function tokenScore(file: string[], agent: string[]): number {
  if (!file.length || !agent.length) return 0;
  const best = file.map((t) => Math.max(...agent.map((u) => (u.startsWith(t) && t.length >= 3 ? 0.9 : ratio(t, u)))));
  return best.reduce((a, b) => a + b, 0) / file.length;
}

export function nameScore(fileName: string, agentName: string | null | undefined): number {
  if (!agentName) return 0;
  return Math.max(ratio(normName(fileName), normName(agentName)), tokenScore(tokens(fileName), tokens(agentName)));
}

export type NameCandidate = { id: string; names: (string | null | undefined)[]; local: boolean };
export type NameSuggestion = { id: string; score: number };

const MIN_SCORE = 0.8;
const LOCAL_BONUS = 0.05;
const MAX_SUGGESTIONS = 3;

// Agen dengan skor ≥ 0,8, agen kantor ini didahulukan sedikit. Paling banyak 3.
export function suggestAgents(fileName: string, list: NameCandidate[]): NameSuggestion[] {
  if (!normName(fileName)) return [];
  return list
    .map((c) => ({ id: c.id, raw: Math.max(0, ...c.names.map((n) => nameScore(fileName, n))), local: c.local }))
    .filter((x) => x.raw >= MIN_SCORE)
    .map((x) => ({ id: x.id, score: Math.min(1, x.raw + (x.local ? LOCAL_BONUS : 0)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);
}
