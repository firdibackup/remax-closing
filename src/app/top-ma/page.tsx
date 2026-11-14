import Link from "next/link";
import { fetchActiveLines } from "@/lib/supabase/fetch-lines";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { rankMa } from "@/lib/closing/rekap";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { PrintButton } from "@/components/print-button";
import { BULAN, Badge, Card, Kpi, PageHeader, Seg, btnCls, compact, fmt, selectCls } from "@/components/ui";
import { NavForm } from "@/components/pending";

// Top MA (PLAN §5 / sheet "Top MA 2026"): Σ komisi per (office induk, MA), per bulan atau YTD.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ bulan?: string; ind?: string; role?: string; all?: string }> };
const TOP_N = 25;
const ROLES: [string, string][] = [["", "Semua role"], ["agent_property", "Agent Property"], ["franchise_owner", "Franchise Owner"]];

export default async function TopMaPage({ searchParams }: Props) {
  const sp = await searchParams;
  const month = Number(sp.bulan) || 0;
  const role = ROLES.some(([v]) => v === sp.role) ? sp.role ?? "" : "";
  const db = supabaseClosingAdmin();
  const [rows, aRes, asRes] = await Promise.all([
    fetchActiveLines(),
    db.from("agents").select("id,role").limit(5000),
    db.from("agent_assignments").select("agent_id").limit(10000),
  ]);
  if (aRes.error) throw new Error(`Gagal baca agen: ${aRes.error.message}`);
  if (asRes.error) throw new Error(`Gagal baca riwayat kantor agen: ${asRes.error.message}`);
  const roleOf = new Map((aRes.data ?? []).map((a) => [a.id as string, a.role as string]));
  const nAssign = new Map<string, number>();
  for (const a of asRes.data ?? []) nAssign.set(a.agent_id as string, (nAssign.get(a.agent_id as string) ?? 0) + 1);
  const inds = [...new Set(rows.map((r) => r.offices?.induk_name ?? ""))].filter(Boolean).sort();
  // Baris tanpa agent_id (agen belum di master) dianggap Agent Property.
  const ranked = rankMa(rows, { month, ind: sp.ind }).map((r) => ({ ...r, role: (r.agentId && roleOf.get(r.agentId)) || "agent_property" })).filter((r) => !role || r.role === role);
  const view = sp.all ? ranked : ranked.slice(0, TOP_N);
  const total = ranked.reduce((a, r) => a + r.gc, 0);
  const max = ranked[0]?.gc || 1;
  const year = rows.find((r) => r.periods)?.periods?.year ?? 2026;
  const base = { ...(month ? { bulan: String(month) } : {}), ...(sp.ind ? { ind: sp.ind } : {}) };
  const href = (r: string, extra: Record<string, string> = {}) => `/top-ma?${new URLSearchParams({ ...base, ...(r ? { role: r } : {}), ...extra })}`;
  const qs = (extra: Record<string, string>) => href(role, extra);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <PageHeader eyebrow="Laporan · rekap" title={`Top MA ${year}`} desc="Peringkat MA berdasarkan GC (Σ Total Komisi) per bulan atau YTD, setara sheet “Top MA 2026”." actions={<PrintButton />} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2.5">
        <NavForm action="/top-ma" className="flex flex-wrap gap-2.5">
          {role ? <input type="hidden" name="role" value={role} /> : null}
          <AutoSubmitSelect name="bulan" defaultValue={String(month)} className={selectCls} aria-label="Bulan">
            <option value="0">YTD {year}</option>
            {BULAN.map((b, i) => <option key={b} value={i + 1}>{b} {year}</option>)}
          </AutoSubmitSelect>
          <AutoSubmitSelect name="ind" defaultValue={sp.ind ?? ""} className={selectCls} aria-label="Office">
            <option value="">Semua office</option>
            {inds.map((x) => <option key={x}>{x}</option>)}
          </AutoSubmitSelect>
        </NavForm>
        <Seg items={ROLES.map(([v, l]) => ({ href: href(v), on: role === v, label: l }))} />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi label="Total MA closing" value={fmt(ranked.length)} />
        <Kpi label="Total GC" value={compact(total)} />
        <Kpi label="MA teratas" value={<span className="text-[19px]">{ranked[0]?.ma ?? "—"}</span>} sub={ranked[0] ? `${ranked[0].induk} · ${compact(ranked[0].gc)}` : ""} />
      </div>
      <Card>
        {ranked.length ? (
          <div className="tw tall">
            <table className="t">
              <thead><tr><th className="num">No</th><th>MA</th><th>Office</th><th className="num">Transaksi</th><th className="num">Total GC</th><th className="hidden md:table-cell" aria-label="Porsi" /></tr></thead>
              <tbody>
                {view.map((r, i) => {
                  const moved = !!r.agentId && (nAssign.get(r.agentId) ?? 0) > 1;
                  return (
                    <tr key={r.key}>
                      <td className="num text-[var(--muted)]">{i < 3 ? <Badge tone={i === 0 ? "red" : "blue"}>{i + 1}</Badge> : i + 1}</td>
                      <td className="font-semibold">
                        {r.agentId ? <Link href={`/master?tab=agen&open=${r.agentId}`} className="text-[var(--ink)] no-underline hover:underline">{r.ma}</Link> : r.ma}
                        {r.role === "franchise_owner" ? <span className="ml-1.5"><Badge tone="red">FO</Badge></span> : null}
                        {moved ? <div className="text-[11.5px] font-medium text-[var(--blue)]">⇄ pindah kantor · total semua kantor {fmt(r.allOffices)}</div> : null}
                      </td>
                      <td className="text-[var(--ink-2)]">{r.induk}</td>
                      <td className="num">{r.count}</td>
                      <td className="num font-bold">{fmt(r.gc)}</td>
                      <td className="hidden w-[28%] md:table-cell">
                        <div className="mt-1.5 h-1.5 rounded-full bg-[var(--line-2)]"><div className={`h-1.5 rounded-full ${i === 0 ? "bg-[var(--red)]" : "bg-[var(--blue)]"}`} style={{ width: `${Math.max(1, (r.gc / max) * 100)}%` }} /></div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="p-10 text-center text-[var(--muted)]"><b className="block text-[var(--ink)]">Belum ada data</b>Periode / filter ini belum ada closing.</div>}
        {ranked.length > TOP_N ? (
          <div className="no-print flex justify-center border-t border-[var(--line-2)] px-4 py-3">
            <Link href={sp.all ? qs({}) : qs({ all: "1" })} className={btnCls}>{sp.all ? `Tampilkan ${TOP_N} teratas` : `Tampilkan semua ${ranked.length} MA`}</Link>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
