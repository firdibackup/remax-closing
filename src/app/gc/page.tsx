import Link from "next/link";
import { fetchActiveLines } from "@/lib/supabase/fetch-lines";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { gcByInduk } from "@/lib/closing/rekap";
import { PrintButton } from "@/components/print-button";
import { Badge, Card, Kpi, PageHeader, btnCls, compact, fmt, selectCls } from "@/components/ui";
import { DownloadButton, NavForm } from "@/components/pending";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { loadYear } from "@/lib/closing/period-data";

// GC Office (PLAN §5 / sheet "GC Office <tahun>"): Σ komisi_gross per kantor induk per bulan, satu tahun (?tahun=). Tampilan heatmap v8.
export const dynamic = "force-dynamic";

const BLN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

type Props = { searchParams: Promise<{ tahun?: string }> };

export default async function GcPage({ searchParams }: Props) {
  const { tahun } = await searchParams;
  const { years, year } = await loadYear(tahun);
  const [rows, oRes] = await Promise.all([fetchActiveLines(year), supabaseClosingAdmin().from("offices").select("induk_name,status").limit(1000)]);
  if (oRes.error) throw new Error(`Gagal baca kantor: ${oRes.error.message}`);
  // Office induk "Aktif" bila minimal satu cabangnya aktif.
  const activeInduk = new Set((oRes.data ?? []).filter((o) => o.status === "aktif").map((o) => o.induk_name as string));
  const offices = gcByInduk(rows);
  const colTotal = BLN.map((_, i) => offices.reduce((s, o) => s + o.series[i], 0));
  const grand = colTotal.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...offices.flatMap((o) => o.series));
  const top = [...offices].sort((a, b) => b.total - a.total)[0];
  const lastMonth = colTotal.findLastIndex((v) => v > 0);

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <PageHeader eyebrow="Laporan · rekap" title={`GC Office ${year}`} desc={`GC = Σ Total Komisi per office induk per bulan, setara sheet “GC Office ${year}”. Bulan baru terisi otomatis dari input Genius & Excel. Klik office untuk melihat barisnya di Data ${year}.`}
        actions={<>
          <NavForm action="/gc" className="flex gap-2">
            <AutoSubmitSelect name="tahun" defaultValue={String(year)} className={selectCls} aria-label="Tahun">
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </AutoSubmitSelect>
          </NavForm>
          <DownloadButton href={`/gc/export?tahun=${year}`} className={btnCls} /><PrintButton />
        </>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={`Total GC ${year}`} value={compact(grand)} sub={`${fmt(rows.length)} baris`} />
        <Kpi label="Office induk" value={offices.length} sub={`punya transaksi ${year}`} />
        <Kpi label="GC tertinggi" value={top?.induk ?? "—"} sub={top ? compact(top.total) : ""} />
        <Kpi label={`GC ${lastMonth >= 0 ? BLN[lastMonth] : "—"}`} value={compact(lastMonth >= 0 ? colTotal[lastMonth] : 0)} sub="bulan terakhir berisi data" />
      </div>
      <Card>
        <div className="tw tall">
          <table className="t">
            <thead>
              <tr>
                <th className="sticky1">Office</th>
                <th>Status</th>
                {BLN.map((b) => <th key={b} className="num">{b}</th>)}
                <th className="num">Grand Total</th>
              </tr>
            </thead>
            <tbody>
              {offices.map((o) => (
                <tr key={o.induk}>
                  <td className="sticky1 font-semibold"><Link href={`/data?${new URLSearchParams({ tahun: String(year), ind: o.induk })}`} className="text-[var(--ink)] no-underline hover:underline">{o.induk}</Link></td>
                  <td>{activeInduk.has(o.induk) ? <Badge tone="green">Aktif</Badge> : <Badge>Tutup</Badge>}</td>
                  {o.series.map((v, i) => {
                    const k = v / max;
                    return (
                      <td key={i} className="num" title={v ? `Rp${fmt(v)}` : undefined}
                        style={{ background: v ? `rgba(0,61,165,${(0.04 + k * 0.5).toFixed(3)})` : undefined, color: k > 0.55 ? "#fff" : v ? undefined : "#C3C8D0" }}>
                        {v ? <>{fmt(v / 1e6)}<span className="opacity-60"> jt</span></> : "–"}
                      </td>
                    );
                  })}
                  <td className="num font-bold">{fmt(o.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="sticky1">Total</td>
                <td />
                {colTotal.map((v, i) => <td key={i} className="num">{v ? `${fmt(v / 1e6)} jt` : "–"}</td>)}
                <td className="num">{fmt(grand)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </main>
  );
}
