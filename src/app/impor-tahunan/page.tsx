import Link from "next/link";
import { Badge, Card, PageHeader, btnCls, btnPriCls, compact, fmt, fmtWib } from "@/components/ui";
import { YearImportForm } from "@/components/year-import-form";
import { DeleteYearButton, ReopenYearButton } from "@/components/year-import-list";
import { Toasts } from "@/components/yearly-kit";
import { YearStatusBadge, YearSteps } from "@/components/yearly-steps";
import { loadYearImports } from "@/lib/yearly/data";

// Impor Data Tahunan, langkah 1: upload Master Data satu tahun → DRAFT → Verifikasi → Simpan ke laporan.
// Selama draft tidak ada baris yang masuk Data/GC/Top MA/Laporan.
export const dynamic = "force-dynamic";

const btnSm = `${btnCls} !px-2.5 !py-1 !text-[12.5px]`;
const btnPriSm = `${btnPriCls} !px-2.5 !py-1 !text-[12.5px]`;

export default async function ImporTahunanPage() {
  const imports = await loadYearImports();
  const drafts = imports.filter((y) => y.status !== "final");
  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        eyebrow="Pengaturan · data lama"
        title="Impor Data Tahunan"
        desc={<>Masukkan data satu tahun dari file <b>Master Data</b> (sheet bernama tahun, mis. “2025”). File masuk sebagai <b>draft</b> dulu. Setelah semua kantor dan MA diverifikasi, tekan <b>Simpan ke laporan</b>: baru saat itu datanya tampil di Data, GC, Top MA, dan Laporan.</>}
      />
      <YearSteps current={1} hrefs={drafts[0] ? { 2: `/verifikasi?tahun=${drafts[0].year}` } : undefined} />

      {drafts.length ? (
        <div className="mb-4 flex flex-col gap-2">
          {drafts.map((y) => {
            const left = y.unresolvedOffices + y.unresolvedPairs;
            return (
              <div key={y.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#F2C46B] bg-[#FFFAF0] px-4 py-3">
                <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-[#FFF4DF] font-display text-[15px] font-extrabold text-[var(--amber)]">2</span>
                <div className="min-w-0 flex-1 text-[13px] text-[#6B4000]">
                  <b className="block text-[14px] text-[var(--ink)]">Draft {y.year} menunggu verifikasi</b>
                  {left
                    ? <>{y.unresolvedOffices ? `${fmt(y.unresolvedOffices)} kantor` : ""}{y.unresolvedOffices && y.unresolvedPairs ? " dan " : ""}{y.unresolvedPairs ? `${fmt(y.unresolvedPairs)} MA` : ""} belum terverifikasi. {fmt(y.totalRows)} baris belum masuk laporan.</>
                    : <>Semua kantor dan MA sudah terverifikasi. Tinggal <b>Simpan ke laporan</b>.</>}
                </div>
                <Link href={`/verifikasi?tahun=${y.year}`} className={btnPriCls}>{left ? `Lanjut verifikasi ${y.year} →` : `Simpan ${y.year} ke laporan →`}</Link>
              </div>
            );
          })}
        </div>
      ) : null}

      <YearImportForm />

      <Card className="mt-4">
        <div className="flex items-center justify-between border-b border-[var(--line-2)] px-5 py-4">
          <h2 className="font-display text-[15px] font-bold">Tahun yang sudah di-upload</h2>
          <span className="text-[12.5px] text-[var(--muted)]">{imports.length} tahun</span>
        </div>
        {imports.length ? (
          <div className="tw">
            <table className="t">
              <thead>
                <tr>
                  <th>Tahun</th><th>Status</th><th>File</th><th className="num">Baris</th><th>Verifikasi</th>
                  <th className="num" title="Baris dengan royalti/SSDF di file berbeda lebih dari Rp2 dari hitung ulang tarif kantor">Selisih hitung ulang</th><th />
                </tr>
              </thead>
              <tbody>
                {imports.map((y) => {
                  const final = y.status === "final";
                  const done = !y.unresolvedOffices && !y.unresolvedPairs;
                  const pct = y.total.rows ? Math.floor((y.ready.rows / y.total.rows) * 100) : 0;
                  return (
                    <tr key={y.id}>
                      <td><b className="font-display text-[18px] font-extrabold">{y.year}</b></td>
                      <td>
                        <YearStatusBadge status={y.status} />
                        <div className="mt-1 text-[11.5px] text-[var(--muted)]">{final && y.finalizedAt ? `disimpan ${fmtWib(y.finalizedAt)}` : `diupload ${fmtWib(y.createdAt)}`}</div>
                      </td>
                      <td className="max-w-[260px]">
                        <div className="truncate font-medium" title={y.sourceFile ?? undefined}>{y.sourceFile ?? "—"}</div>
                        <div className="text-[12px] text-[var(--muted)]">sheet “{y.sheet ?? "—"}”{y.skippedRows ? ` · ${fmt(y.skippedRows)} baris dilewati` : ""}</div>
                      </td>
                      <td className="num">
                        <b>{fmt(y.totalRows)}</b>
                        <div className="text-[12px] text-[var(--muted)]">GC {compact(y.total.gc)}</div>
                      </td>
                      <td>
                        {final ? <span className="text-[12.5px] text-[var(--green)]">Selesai</span> : done ? <Badge tone="green">Semua terverifikasi</Badge> : (
                          <div className="flex flex-col gap-1">
                            <div className="flex flex-wrap gap-1">
                              {y.unresolvedOffices ? <Badge tone="amber">{fmt(y.unresolvedOffices)} kantor belum</Badge> : null}
                              {y.unresolvedPairs ? <Badge tone="amber">{fmt(y.unresolvedPairs)} MA belum</Badge> : null}
                            </div>
                            <div className="flex items-center gap-2 text-[11.5px] text-[var(--muted)]">
                              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-[var(--line-2)]" aria-hidden><span className="block h-full bg-[var(--green)]" style={{ width: `${pct}%` }} /></span>
                              {pct}% baris lengkap
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="num">{y.recalcDiffs ? <span className="font-semibold text-[var(--amber)]">{fmt(y.recalcDiffs)} baris</span> : <span className="text-[var(--green)]">0</span>}</td>
                      <td>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {final ? (
                            <>
                              <Link href={`/data?tahun=${y.year}`} className={btnSm}>Lihat Data</Link>
                              <Link href={`/verifikasi?tahun=${y.year}`} className={btnSm}>Lihat verifikasi</Link>
                              <ReopenYearButton year={y.year} rows={y.totalRows} className={`${btnSm} disabled:opacity-50`} />
                            </>
                          ) : (
                            <Link href={`/verifikasi?tahun=${y.year}`} className={btnPriSm}>{done ? "Simpan ke laporan" : "Verifikasi"}</Link>
                          )}
                          <DeleteYearButton year={y.year} file={y.sourceFile} status={y.status} rows={y.totalRows} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="px-5 py-8 text-center text-[var(--muted)]">Belum ada data tahunan. Upload file Master Data di atas.</div>}
        {imports.some((y) => y.recalcDiffs) ? (
          <p className="border-t border-[var(--line-2)] px-5 py-2.5 text-[12px] text-[var(--muted)]">Selisih hitung ulang: royalti/SSDF di file berbeda lebih dari Rp2 dari hitungan tarif kantor. Laporan memakai hasil hitung ulang; angka file disimpan sebagai pembanding.</p>
        ) : null}
      </Card>
      <Toasts />
    </main>
  );
}
