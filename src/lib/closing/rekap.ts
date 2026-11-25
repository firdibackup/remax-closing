// Rekap GC Office & Top MA (sheet "GC Office <tahun>" dan "Top MA <tahun>"; baris sudah satu tahun). Murni: dipakai halaman dan ekspor .xlsx.
export type RekapLine = {
  komisi_gross: number | string;
  ma_name: string | null;
  agent_id: string | null;
  offices: { induk_name: string; cabang_name: string } | null;
  periods: { id: string; month: number; year: number; status: string } | null;
};

export type GcRow = { induk: string; series: number[]; total: number };
const MONTHS = 12;
const gcOf = (r: RekapLine) => Number(r.komisi_gross) || 0;
const normName = (s: string | null) => (s ?? "").trim().toUpperCase();

export function gcByInduk(rows: RekapLine[]): GcRow[] {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const m = r.periods?.month;
    if (!m) continue;
    const induk = r.offices?.induk_name ?? "?";
    const series = by.get(induk) ?? Array<number>(MONTHS).fill(0);
    series[m - 1] += gcOf(r);
    by.set(induk, series);
  }
  return [...by.entries()].map(([induk, series]) => ({ induk, series, total: series.reduce((a, b) => a + b, 0) })).sort((a, b) => a.induk.localeCompare(b.induk));
}

export type MaRow = { key: string; induk: string; ma: string; agentId: string | null; gc: number; count: number; allOffices: number };

// Satu baris per (office induk, MA). MA dikenali lewat agent_id; baris tanpa agent_id lewat nama (huruf besar, tanpa spasi tepi).
// allOffices = total GC agen yang sama di semua office (untuk agen pindah kantor).
export function rankMa(rows: RekapLine[], f: { month: number; ind?: string }): MaRow[] {
  const by = new Map<string, MaRow>();
  for (const r of rows) {
    if (f.month && r.periods?.month !== f.month) continue;
    const induk = r.offices?.induk_name ?? "?";
    if (f.ind && induk !== f.ind) continue;
    const who = r.agent_id ?? `nama:${normName(r.ma_name)}`;
    const key = `${induk}|${who}`;
    const cur = by.get(key) ?? { key, induk, ma: (r.ma_name ?? "").trim() || "—", agentId: r.agent_id, gc: 0, count: 0, allOffices: 0 };
    by.set(key, { ...cur, gc: cur.gc + gcOf(r), count: cur.count + 1 });
  }
  const list = [...by.values()];
  const perAgent = new Map<string, number>();
  for (const x of list) if (x.agentId) perAgent.set(x.agentId, (perAgent.get(x.agentId) ?? 0) + x.gc);
  return list
    .map((x) => ({ ...x, allOffices: x.agentId ? perAgent.get(x.agentId) ?? x.gc : x.gc }))
    .filter((x) => x.gc > 0)
    .sort((a, b) => b.gc - a.gc);
}
