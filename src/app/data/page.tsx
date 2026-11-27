import { SOURCES, fetchActiveLines, filterDataRows } from "@/lib/supabase/fetch-lines";
import { BULAN, Card, PageHeader, SourceBadge, btnCls, btnPriCls, rupiah, fmt, selectCls } from "@/components/ui";
import { DownloadButton, NavForm, NavSubmit } from "@/components/pending";
import Link from "next/link";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { loadYear, monthsOfYear } from "@/lib/closing/period-data";

// Data Tahunan (sheet "<tahun>" di Master Data): baris komisi per transaksi satu tahun, filter bulan / office / cari. Tampilan v8.
export const dynamic = "force-dynamic";

const PAGE_ROWS = 100;
const n = (v: number | string) => fmt(Number(v) || 0);

type Props = { searchParams: Promise<{ tahun?: string; bulan?: string; ind?: string; src?: string; q?: string; page?: string }> };

export default async function DataPage({ searchParams }: Props) {
  const { tahun, bulan, ind, src, q, page } = await searchParams;
  const pageNo = Math.max(1, Number(page) || 1);
  const { periods, years, year } = await loadYear(tahun);
  const all = await fetchActiveLines(year);
  const months = monthsOfYear(periods, all, year);
  const month = months.includes(Number(bulan)) ? Number(bulan) : 0;
  const inds = [...new Set(all.map((r) => r.offices?.induk_name ?? ""))].filter(Boolean).sort();
  const rows = filterDataRows(all, { month, ind, src, q });
  const total = rows.reduce((acc, r) => acc + (Number(r.komisi_gross) || 0), 0);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_ROWS));
  const view = rows.slice((pageNo - 1) * PAGE_ROWS, pageNo * PAGE_ROWS);
  const params = { tahun: String(year), ...(month ? { bulan: String(month) } : {}), ...(ind ? { ind } : {}), ...(src ? { src } : {}), ...(q ? { q } : {}) };
  const link = (p: number) => `/data?${new URLSearchParams({ ...params, page: String(p) })}`;
  const exportHref = `/data/export?${new URLSearchParams(params)}`;

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <PageHeader eyebrow="Laporan · master" title={`Data ${year}`} desc={`Setara sheet “${year}” di Master Data. Baris hasil impor tidak punya Closing/Invoice ID; baris baru dari input Genius & Excel menyimpan Closing ID & Invoice ID.`} actions={<DownloadButton href={exportHref} className={btnCls} />} />
      <Card className="mb-4 p-4">
        <NavForm action="/data" className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-[auto_1fr_1fr_1fr_2fr_auto]">
          <AutoSubmitSelect name="tahun" defaultValue={String(year)} className={`${selectCls} w-full`} aria-label="Tahun">
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </AutoSubmitSelect>
          <select name="bulan" defaultValue={String(month)} className={selectCls} aria-label="Bulan">
            <option value="0">Semua bulan {year}</option>
            {months.map((m) => <option key={m} value={m}>{BULAN[m - 1]}</option>)}
          </select>
          <select name="ind" defaultValue={ind ?? ""} className={selectCls} aria-label="Office induk">
            <option value="">Semua office</option>
            {inds.map((x) => <option key={x}>{x}</option>)}
          </select>
          <select name="src" defaultValue={src ?? ""} className={selectCls} aria-label="Sumber">
            <option value="">Semua sumber</option>
            {SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <input name="q" defaultValue={q ?? ""} placeholder="Cari MA, alamat, kantor, Closing/Invoice ID…" className={selectCls} />
          <NavSubmit className={btnPriCls}>Terapkan</NavSubmit>
        </NavForm>
        <div className="mt-2.5 text-[12.5px] text-[var(--muted)]">{fmt(rows.length)} baris · GC {rupiah(total)}</div>
      </Card>
      <Card>
        <div className="tw tall">
          <table className="t">
            <thead>
              <tr>
                <th>Month</th><th>Office</th><th>REMAX</th><th>Closing ID</th><th>Invoice ID</th><th>Bayar Via</th><th className="num">Plafond</th><th>COMM/RES</th><th>Solo/Cobroke</th><th>P/S/R</th><th>L/S/LS</th><th>MA</th>
                <th className="num">Transaksi</th><th className="num">Total Komisi</th><th className="num">Royalti</th><th className="num">PPN</th><th className="num">SSDF</th><th className="num">PPN</th>
                <th className="num">PPh Royalti</th><th className="num">PPh SSDF</th><th className="num">ke RMI</th><th className="num">Net Komisi</th><th>Alamat</th><th>Kantor Cobroke</th><th>MA Cobroke</th><th>Sumber</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r, i) => (
                <tr key={i}>
                  <td>{BULAN[(r.periods?.month ?? 1) - 1].toUpperCase()}</td>
                  <td>{r.offices?.induk_name}</td><td className="whitespace-nowrap">{r.offices?.cabang_name}</td>
                  <td className="whitespace-nowrap font-mono text-[12px]">{r.closing_code ?? "—"}</td><td className="whitespace-nowrap font-mono text-[12px]">{r.invoice_number ?? "—"}</td>
                  <td className="whitespace-nowrap">{r.bayar_via}</td><td className="num">{r.plafond_kpr == null ? "" : n(r.plafond_kpr)}</td><td>{r.res_comm}</td><td>{r.solo_cobroke}</td><td>{r.psr}</td><td>{r.lsl}</td>
                  <td className="min-w-[160px] font-medium">{r.ma_name}</td>
                  <td className="num">{n(r.nilai_transaksi)}</td><td className="num font-bold">{n(r.komisi_gross)}</td>
                  <td className="num">{n(r.royalti)}</td><td className="num">{n(r.ppn_royalti)}</td><td className="num">{n(r.ssdf)}</td><td className="num">{n(r.ppn_ssdf)}</td>
                  <td className="num">{n(r.pph_royalti)}</td><td className="num">{n(r.pph_ssdf)}</td><td className="num">{n(r.ke_rmi)}</td><td className="num">{n(r.net_komisi)}</td>
                  <td className="min-w-[220px]">{r.alamat}</td><td>{r.kantor_cobroke}</td><td>{r.ma_cobroke}</td><td><SourceBadge source={r.source} /></td>
                </tr>
              ))}
              {!view.length && <tr><td colSpan={26} className="p-10 text-center text-[var(--muted)]">Tidak ada baris.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--line-2)] px-4 py-3 text-[12.5px] text-[var(--muted)]">
          <span>Halaman {pageNo} dari {pages}</span>
          <div className="flex gap-2">
            {pageNo > 1 && <Link className={btnCls} href={link(pageNo - 1)}>← Sebelumnya</Link>}
            {pageNo < pages && <Link className={btnCls} href={link(pageNo + 1)}>Berikutnya →</Link>}
          </div>
        </div>
      </Card>
    </main>
  );
}
