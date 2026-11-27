import Link from "next/link";
import { loadRanking, parseRole, ROLES } from "@/lib/top-ma/data";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { PrintButton } from "@/components/print-button";
import { BULAN, Badge, Card, Kpi, PageHeader, Seg, btnCls, btnPriCls, rupiah, fmt, selectCls } from "@/components/ui";
import { NavForm } from "@/components/pending";
import { redirect } from "next/navigation";
import { loadYear, monthsOfYear } from "@/lib/closing/period-data";

// Top MA (PLAN §5 / sheet "Top MA <tahun>"): Σ komisi per (office induk, MA), per bulan atau YTD satu tahun (?tahun=).
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ tahun?: string; bulan?: string; ind?: string; role?: string; all?: string; poster?: string }> };
const TOP_N = 25;

export default async function TopMaPage({ searchParams }: Props) {
  const sp = await searchParams;
  // Link lama ?poster=top10|top50 (dulu drawer) → halaman poster penuh.
  if (sp.poster === "top10" || sp.poster === "top50") {
    const r = parseRole(sp.role);
    redirect(`/top-ma/poster?${new URLSearchParams({ ...(sp.tahun ? { tahun: sp.tahun } : {}), ...(sp.bulan ? { bulan: sp.bulan } : {}), ...(r ? { role: r } : {}), t: sp.poster })}`);
  }
  const { periods, years, year } = await loadYear(sp.tahun);
  const role = parseRole(sp.role);
  const asked = Number(sp.bulan) || 0;
  const first = await loadRanking({ year, month: asked, ind: sp.ind, role });
  const { inds, nAssign, monthsWithData } = first;
  // Bulan hanya dari periode/baris tahun ini; bulan yang tidak ada di tahun ini (mis. setelah ganti tahun) → YTD.
  const months = monthsOfYear(periods, monthsWithData.map((m) => ({ periods: { month: m } })), year);
  const month = months.includes(asked) ? asked : 0;
  const ranked = month === asked ? first.ranked : (await loadRanking({ year, month, ind: sp.ind, role })).ranked;
  const view = sp.all ? ranked : ranked.slice(0, TOP_N);
  const total = ranked.reduce((a, r) => a + r.gc, 0);
  const max = ranked[0]?.gc || 1;
  const base = { tahun: String(year), ...(month ? { bulan: String(month) } : {}), ...(sp.ind ? { ind: sp.ind } : {}) };
  const href = (r: string, extra: Record<string, string> = {}) => `/top-ma?${new URLSearchParams({ ...base, ...(r ? { role: r } : {}), ...extra })}`;
  const qs = (extra: Record<string, string>) => href(role, extra);
  // Poster Top MA All Office: per bulan, tanpa filter office (poster per office nanti pakai template sendiri).
  const posterLabel = `Poster Top MA ${year} All Office`;
  const posterOff = sp.ind ? "Poster per office pakai template sendiri (belum tersedia)" : !month ? "Pilih satu bulan dulu" : !ranked.length ? "Belum ada closing di bulan ini" : null;
  const posterHref = `/top-ma/poster?${new URLSearchParams({ tahun: String(year), bulan: String(month), ...(role ? { role } : {}), t: "top10" })}`;

  return (
    <main className="mx-auto max-w-6xl p-6">
      <PageHeader eyebrow="Laporan · rekap" title={`Top MA ${year}`} desc={`Peringkat MA berdasarkan GC (Σ Total Komisi) per bulan atau YTD, setara sheet “Top MA ${year}”.`} actions={<>
        {posterOff ? <span role="link" aria-disabled="true" tabIndex={0} className={`${btnCls} cursor-not-allowed opacity-50`} title={posterOff} aria-label={`${posterLabel} (${posterOff})`}>{posterLabel}</span>
          : <Link href={posterHref} className={btnPriCls}>{posterLabel}</Link>}
        <PrintButton />
      </>} />
      <div className="no-print mb-4 flex flex-wrap items-center gap-2.5">
        <NavForm action="/top-ma" className="flex flex-wrap gap-2.5">
          {role ? <input type="hidden" name="role" value={role} /> : null}
          <AutoSubmitSelect name="tahun" defaultValue={String(year)} className={selectCls} aria-label="Tahun">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </AutoSubmitSelect>
          <AutoSubmitSelect name="bulan" defaultValue={String(month)} className={selectCls} aria-label="Bulan">
            <option value="0">YTD {year}</option>
            {months.map((m) => <option key={m} value={m}>{BULAN[m - 1]} {year}</option>)}
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
        <Kpi label="Total GC" value={rupiah(total)} />
        <Kpi label="MA teratas" value={<span className="text-[19px]">{ranked[0]?.ma ?? "—"}</span>} sub={ranked[0] ? `${ranked[0].induk} · ${rupiah(ranked[0].gc)}` : ""} />
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
