import Link from "next/link";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { NavForm } from "@/components/pending";
import { Card, Kpi, PageHeader, btnCls, btnPriCls, compact, fmt, fmtWib, selectCls } from "@/components/ui";
import { VerifyAgents } from "@/components/verify-agents";
import { VerifyOffices } from "@/components/verify-offices";
import { FinalizeBar, ReopenYearButton } from "@/components/year-import-list";
import { Toasts } from "@/components/yearly-kit";
import { YearStatusBadge, YearSteps } from "@/components/yearly-steps";
import { loadVerification, loadYearImports } from "@/lib/yearly/data";

// Impor Data Tahunan, langkah 2 & 3: verifikasi kantor lalu MA (hanya menyimpan peta nama), lalu Simpan ke laporan
// (aktif hanya kalau semua sudah terverifikasi). Impor yang sudah final tampil baca-saja sampai dibuka kembali.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ tahun?: string }> };

export default async function VerifikasiPage({ searchParams }: Props) {
  const { tahun } = await searchParams;
  const imports = await loadYearImports();
  const header = (
    <PageHeader eyebrow="Pengaturan · impor tahunan" title="Verifikasi Kantor & MA"
      desc={<>File Master Data hanya berisi nama. Hubungkan setiap nama cabang ke kantor, lalu setiap nama MA ke <b>Agent ID</b>. Data <b>belum masuk laporan</b> sampai semuanya terverifikasi dan Anda tekan <b>Simpan ke laporan</b>.</>}
      actions={<Link href="/impor-tahunan" className={btnCls}>← Upload file</Link>} />
  );
  if (!imports.length) {
    return (
      <main className="mx-auto max-w-[1400px] p-6">
        {header}
        <YearSteps current={1} hrefs={{ 1: "/impor-tahunan" }} />
        <Card className="px-5 py-12 text-center text-[var(--muted)]">
          <b className="block text-[var(--ink)]">Belum ada file yang di-upload</b>
          Mulai dari langkah 1: upload file Master Data di <Link href="/impor-tahunan" className="font-semibold">Impor Data Tahunan</Link>.
        </Card>
      </main>
    );
  }
  const sum = imports.find((y) => String(y.year) === tahun) ?? imports.find((y) => y.status !== "final") ?? imports[0];
  const v = await loadVerification(sum.year);
  const final = v.status === "final";
  const officesLeft = v.offices.length, pairsLeft = v.pairs.length;
  const allDone = !officesLeft && !pairsLeft;
  const total = sum.total.rows || 1;
  const pct = Math.floor((sum.ready.rows / total) * 100);

  return (
    <main className="mx-auto max-w-[1400px] p-6 pb-0">
      {header}
      <YearSteps current={final ? 4 : allDone ? 3 : 2} year={sum.year} hrefs={{ 1: "/impor-tahunan" }} />

      <Card className="mb-4 flex flex-wrap items-center gap-3 p-4">
        <NavForm action="/verifikasi" className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-[var(--ink-2)]">Tahun</span>
          <AutoSubmitSelect name="tahun" defaultValue={String(sum.year)} className={selectCls} aria-label="Tahun">
            {imports.map((y) => (
              <option key={y.year} value={y.year}>
                {y.year} · {y.status === "final" ? "tersimpan" : y.unresolvedOffices || y.unresolvedPairs ? `draft, ${fmt(y.unresolvedOffices + y.unresolvedPairs)} belum` : "draft, siap disimpan"}
              </option>
            ))}
          </AutoSubmitSelect>
        </NavForm>
        <YearStatusBadge status={v.status} big />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--muted)]" title={sum.sourceFile ?? undefined}>
          {sum.sourceFile ?? "—"} · {fmt(sum.totalRows)} baris · GC {compact(sum.total.gc)}
        </span>
        {final ? <Link href={`/data?tahun=${sum.year}`} className={`${btnCls} !px-2.5 !py-1 !text-[12.5px]`}>Lihat Data {sum.year}</Link> : null}
      </Card>

      {final ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-[#BFE3D0] bg-[#F1FAF5] px-4 py-3.5">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-full bg-[var(--green)] text-[18px] text-white">✓</span>
          <div className="min-w-0 flex-1 text-[13px] text-[#0B5333]">
            <b className="block font-display text-[16px] text-[var(--ink)]">Data {sum.year} sudah tersimpan di laporan</b>
            {fmt(sum.totalRows)} baris tampil di Data, GC, Top MA, dan Laporan{sum.finalizedAt ? ` sejak ${fmtWib(sum.finalizedAt)}` : ""}. Halaman ini hanya bisa dilihat. <b>Buka kembali</b> untuk mengubah verifikasi.
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/data?tahun=${sum.year}`} className={btnPriCls}>Lihat Data {sum.year}</Link>
            <Link href={`/gc?tahun=${sum.year}`} className={btnCls}>GC Office</Link>
            <Link href={`/top-ma?tahun=${sum.year}`} className={btnCls}>Top MA</Link>
            <ReopenYearButton year={sum.year} rows={sum.totalRows} className={btnCls} />
          </div>
        </div>
      ) : (
        <>
          <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Kantor belum terhubung" value={<span className={officesLeft ? "text-[var(--amber)]" : "text-[var(--green)]"}>{fmt(officesLeft)}</span>} sub={`${fmt(v.resolvedOffices.length)} sudah terhubung`} />
            <Kpi label="MA belum punya Agent ID" value={<span className={pairsLeft ? "text-[var(--amber)]" : "text-[var(--green)]"}>{fmt(pairsLeft)}</span>} sub={officesLeft ? `${fmt(v.resolvedPairs.length)} sudah · + MA di kantor yang belum terhubung` : `${fmt(v.resolvedPairs.length)} sudah terverifikasi`} />
            <Kpi label="Baris lengkap" value={fmt(sum.ready.rows)} sub={`${pct}% · GC ${compact(sum.ready.gc)}`} />
            <Kpi label="Baris belum lengkap" value={<span className={sum.pending.rows ? "text-[var(--amber)]" : ""}>{fmt(sum.pending.rows)}</span>} sub={`GC ${compact(sum.pending.gc)}`} />
          </div>
          <div className="mb-1.5 flex h-2 overflow-hidden rounded-full bg-[var(--line-2)]" aria-hidden>
            <span className="bg-[var(--green)]" style={{ width: `${(sum.ready.rows / total) * 100}%` }} />
            <span className="bg-[#F2C46B]" style={{ width: `${(sum.pending.rows / total) * 100}%` }} />
          </div>
          <p className="mb-4 text-[12px] text-[var(--muted)]">Draft: semua {fmt(sum.totalRows)} baris belum masuk laporan, termasuk yang sudah lengkap. Semuanya masuk sekaligus di langkah 3.</p>

          {allDone ? (
            <Card className="mb-4 px-5 py-8 text-center">
              <span className="mx-auto mb-2 grid h-11 w-11 place-items-center rounded-full bg-[#E7F5EE] text-[20px] text-[var(--green)]">✓</span>
              <b className="block font-display text-[18px] font-extrabold">Semua kantor dan MA {sum.year} sudah terverifikasi</b>
              <p className="mt-1 text-[var(--muted)]">Tekan <b className="text-[var(--ink)]">Simpan {sum.year} ke laporan</b> di bawah untuk memasukkan {fmt(sum.totalRows)} baris ke Data, GC, Top MA, dan Laporan.</p>
            </Card>
          ) : null}
        </>
      )}

      <div className="flex flex-col gap-4">
        <VerifyOffices offices={v.offices} resolved={v.resolvedOffices} options={v.officeOptions} readOnly={final} />
        <VerifyAgents year={sum.year} pairs={v.pairs} resolved={v.resolvedPairs} agents={v.agents} officesPending={officesLeft} readOnly={final} />
      </div>

      {final ? <div className="h-6" /> : (
        <FinalizeBar year={sum.year} offices={officesLeft} pairs={pairsLeft} rows={sum.totalRows} gc={sum.total.gc} otherLines={sum.otherLines} />
      )}
      <Toasts lift={!final} />
    </main>
  );
}
