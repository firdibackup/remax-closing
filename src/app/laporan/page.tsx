import { fetchActiveLines, fetchCancelledLines, kategoriOf, type LineRow } from "@/lib/supabase/fetch-lines";
import { LineActions, RestoreButton } from "@/components/line-actions";
import { PrintButton } from "@/components/print-button";
import { BULAN, Badge, Card, Kpi, PageHeader, Seg, SourceBadge, btnCls, btnPriCls, compact, fmt, fmtDate, selectCls } from "@/components/ui";
import { DownloadButton, NavForm, NavSubmit } from "@/components/pending";
import { loadPeriods } from "@/lib/closing/period-data";
import { isFuture } from "@/lib/closing/periods";
import { isFinanceView } from "@/lib/supabase/auth-server";

// Laporan Bulanan (PLAN §5 / template "Perhitungan Komisi"): tab 3,5% dan 9%, per bulan. Tampilan v8.
export const dynamic = "force-dynamic";

const sum = (rows: LineRow[], key: keyof LineRow) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
const n = (v: number | string) => fmt(Number(v) || 0);

const MONEY: [keyof LineRow, string][] = [
  ["komisi_gross", "Komisi Gross (A)"], ["royalti", "Royalti (B)"], ["ppn_royalti", "PPN (C)"], ["pph_royalti", "PPh 23 (D)"], ["total_royalti", "Total Royalti (E)"],
  ["ssdf", "SSDF (F)"], ["ppn_ssdf", "PPN (G)"], ["pph_ssdf", "PPh 23 (H)"], ["total_ssdf", "Total SSDF (I)"], ["ke_rmi", "Ke RMI (J)"], ["net_komisi", "Net Komisi (K)"],
];

type Props = { searchParams: Promise<{ bulan?: string; kat?: string; cab?: string }> };

export default async function LaporanPage({ searchParams }: Props) {
  const { bulan, kat, cab } = await searchParams;
  const finance = await isFinanceView();
  const [all, periods] = await Promise.all([fetchActiveLines(), loadPeriods()]);
  // Bulan berisi data + periode yang sudah mulai (periode terbuka yang masih kosong tetap bisa dipilih).
  const months = [...new Set([...all.map((r) => r.periods?.month), ...periods.filter((p) => !isFuture(p)).map((p) => p.month)].filter((m): m is number => !!m))].sort((a, b) => a - b);
  const month = Number(bulan) || months[months.length - 1] || 1;
  const kategori = kat === "9" ? "9" : "3.5";

  const inMonth = all.filter((r) => r.periods?.month === month);
  const cancelled = (await fetchCancelledLines(month)).filter((r) => kategoriOf(r) === kategori && (!cab || r.offices?.cabang_name === cab));
  const isOpen = inMonth.some((r) => r.periods?.status === "open") || cancelled.some((r) => r.periods?.status === "open");
  const editable = (r: LineRow) => !finance && isOpen && r.periods?.status === "open" && r.source !== "import";
  const exportHref = `/laporan/export?bulan=${month}${cab ? `&cab=${encodeURIComponent(cab)}` : ""}`;
  const label = `${BULAN[month - 1]} 2026`;
  const inKat = inMonth.filter((r) => kategoriOf(r) === kategori);
  const cabs = [...new Set(inKat.map((r) => r.offices?.cabang_name ?? ""))].filter(Boolean).sort();
  const rows = cab ? inKat.filter((r) => r.offices?.cabang_name === cab) : inKat;
  const count = (k: "3.5" | "9") => inMonth.filter((r) => kategoriOf(r) === k).length;
  const q = (b: number, k: string) => `/laporan?bulan=${b}&kat=${k}`;

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        eyebrow={`Laporan · ${BULAN[month - 1]} 2026`}
        title={`Laporan Bulanan ${kategori === "9" ? "9%" : "3,5%"}`}
        desc={`Setara sheet “Perhitungan Komisi”. Royalti ${kategori === "9" ? "1%" : "0,5%"} · SSDF ${kategori === "9" ? "8%" : "3%"} · PPN 11% · PPh 23 15% / 2%.`}
        actions={
          <>
          <NavForm className="flex flex-wrap items-center gap-2" action="/laporan">
            <input type="hidden" name="kat" value={kategori} />
            <select name="bulan" defaultValue={String(month)} className={selectCls} aria-label="Bulan">
              {months.map((m) => <option key={m} value={m}>{BULAN[m - 1]} 2026</option>)}
            </select>
            <NavSubmit className={btnPriCls}>Terapkan</NavSubmit>
          </NavForm>
          <DownloadButton href={exportHref} className={btnCls} />
          <PrintButton />
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Seg items={(["3.5", "9"] as const).map((k) => ({ href: q(month, k), on: k === kategori, label: <>{k === "9" ? "9%" : "3,5%"} <span className="ml-1 text-[var(--muted)]">{count(k)}</span></> }))} />
        <NavForm action="/laporan" className="no-print flex items-center gap-2">
          <input type="hidden" name="bulan" value={month} />
          <input type="hidden" name="kat" value={kategori} />
          <select name="cab" defaultValue={cab ?? ""} className={selectCls} aria-label="Kantor">
            <option value="">Semua kantor ({cabs.length})</option>
            {cabs.map((c) => <option key={c}>{c}</option>)}
          </select>
          <NavSubmit className={btnPriCls}>Filter</NavSubmit>
        </NavForm>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Komisi Gross (A)" value={compact(sum(rows, "komisi_gross"))} sub={`${rows.length} baris`} />
        <Kpi label="Royalti (B)" value={compact(sum(rows, "royalti"))} sub={`Setelah pajak ${compact(sum(rows, "total_royalti"))}`} />
        <Kpi label="SSDF (F)" value={compact(sum(rows, "ssdf"))} sub={`Setelah pajak ${compact(sum(rows, "total_ssdf"))}`} />
        <Kpi label="Pembayaran ke RMI (J)" value={compact(sum(rows, "ke_rmi"))} sub={`Net komisi ${compact(sum(rows, "net_komisi"))}`} />
      </div>
      <Card>
        {rows.length ? (
          <div className="tw tall">
            <table className="t">
              <thead>
                <tr>
                  <th className="sticky1">No</th><th>Tanggal</th><th>Office</th><th>Closing ID</th><th>Invoice ID</th><th>Bayar</th><th>RES/COMM</th><th>Solo/Cobroke</th><th>P/S/R</th><th>L/S/LS</th><th>MA</th>
                  <th className="num">Nilai Transaksi</th><th>Alamat</th><th>Kantor Cobroke</th><th>MA Cobroke</th>
                  {MONEY.map(([k, l]) => <th key={k} className="num">{l}</th>)}
                  <th>Sumber</th>
                  {finance ? null : <th className="no-print">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="sticky1 text-[var(--muted)]">{i + 1}</td>
                    <td className="whitespace-nowrap">{fmtDate(r.tanggal_transaksi)}</td>
                    <td className="whitespace-nowrap">{r.offices?.cabang_name}</td>
                    <td className="whitespace-nowrap font-mono text-[12px]">{r.closing_code ?? "—"}</td>
                    <td className="whitespace-nowrap font-mono text-[12px]">{r.invoice_number ?? "—"}</td>
                    <td className="whitespace-nowrap">{r.bayar_via}</td><td>{r.res_comm}</td><td>{r.solo_cobroke}</td><td>{r.psr}</td><td>{r.lsl}</td>
                    <td className="min-w-[160px] font-medium">{r.ma_name}</td>
                    <td className="num">{n(r.nilai_transaksi)}</td>
                    <td className="min-w-[220px]">{r.alamat}</td><td>{r.kantor_cobroke}</td><td>{r.ma_cobroke}</td>
                    {MONEY.map(([k]) => <td key={k} className={`num ${k === "komisi_gross" ? "font-bold" : ""}`}>{n(r[k] as number)}</td>)}
                    <td><SourceBadge source={r.source} /></td>
                    {finance ? null : <td className="no-print whitespace-nowrap">{editable(r) ? <LineActions line={{ id: r.id, ma_name: r.ma_name, bayar_via: r.bayar_via, res_comm: r.res_comm, solo_cobroke: r.solo_cobroke, psr: r.psr, lsl: r.lsl, nilai_transaksi: Number(r.nilai_transaksi) || 0, komisi_gross: Number(r.komisi_gross) || 0, alamat: r.alamat, kantor_cobroke: r.kantor_cobroke, ma_cobroke: r.ma_cobroke, closing_code: r.closing_code, label }} /> : <span className="text-[12px] text-[var(--muted)]">{r.source === "import" ? "Impor" : "Terkunci"}</span>}</td>}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="sticky1" /><td colSpan={10}>Total {rows.length} baris</td>
                  <td className="num">{fmt(sum(rows, "nilai_transaksi"))}</td><td colSpan={3} />
                  {MONEY.map(([k]) => <td key={k} className="num">{fmt(sum(rows, k))}</td>)}
                  <td />
                  {finance ? null : <td className="no-print" />}
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="p-10 text-center text-[var(--muted)]"><b className="block text-[var(--ink)]">Belum ada baris {kategori === "9" ? "9%" : "3,5%"} di {BULAN[month - 1]}</b>Input dari Genius atau upload Excel kantor.</div>
        )}
      </Card>
      {cancelled.length ? (
        <Card className="mt-4">
          <div className="border-b border-[var(--line-2)] px-5 py-3">
            <h2 className="text-[15px] font-bold">Dibatalkan · {cancelled.length} baris</h2>
            <p className="text-[12.5px] text-[var(--muted)]">Tidak dihitung di laporan, Data 2026, GC Office, Top MA, dan Rekonsiliasi. Alasan tercatat di log.</p>
          </div>
          <div className="tw">
            <table className="t">
              <thead><tr><th>Closing / Invoice</th><th>Kantor</th><th>MA</th><th className="num">Komisi Gross</th><th>Dibatalkan</th><th /></tr></thead>
              <tbody>
                {cancelled.map((r) => (
                  <tr key={r.id} className="text-[var(--muted)]">
                    <td className="font-mono text-[12px]"><s>{r.closing_code ?? "—"}</s><div>{r.invoice_number}</div></td>
                    <td>{r.offices?.cabang_name}</td>
                    <td>{r.ma_name}</td>
                    <td className="num"><s>{n(r.komisi_gross)}</s></td>
                    <td>{new Date(r.batal_at).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" })}</td>
                    <td>{r.periods?.status === "open" && !finance ? <RestoreButton id={r.id} label={`${r.ma_name ?? ""} · ${label}`} /> : <Badge>Terkunci</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </main>
  );
}
