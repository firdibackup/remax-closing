"use client";

import { deleteYearImport, finalizeYearImport, reopenYearImport } from "@/app/actions/yearly";
import { YDialog, btnSm, dangerSm } from "@/components/yearly-kit";
import { CheckItem } from "@/components/yearly-steps";
import { rupiah, fmt } from "@/components/ui";

// Aksi satu impor tahunan: hapus, buka kembali (final → draft), dan Simpan ke laporan (draft → final).

export function DeleteYearButton({ year, file, status, rows }: { year: number; file: string | null; status: "draft" | "final"; rows: number }) {
  return (
    <YDialog label="Hapus" triggerClass={dangerSm} title={`Hapus impor ${year}?`} eyebrow="Impor Data Tahunan" submit={status === "final" ? `Hapus & tarik dari laporan` : `Hapus draft ${year}`} danger action={deleteYearImport}>
      <input type="hidden" name="year" value={year} />
      {status === "final" ? (
        <>
          <p className="text-[13px] text-[var(--ink-2)]">
            Data {year} {file ? <>(<b>{file}</b>)</> : null} <b>sudah tersimpan di laporan</b>. Menghapusnya akan menarik <b>{fmt(rows)} baris</b> dari Data, GC, Top MA, dan Laporan {year}.
          </p>
          <p className="rounded-lg bg-[var(--red-50)] px-3 py-2 text-[12.5px] text-[#8A0F1B]">Tidak bisa dibatalkan. Kalau hanya ingin memperbaiki verifikasi, pakai <b>Buka kembali</b>.</p>
        </>
      ) : (
        <>
          <p className="text-[13px] text-[var(--ink-2)]">
            Draft {year} {file ? <>(<b>{file}</b>, </> : "("}{fmt(rows)} baris) dihapus. Draft belum masuk laporan, jadi Data, GC, Top MA, dan Laporan tidak berubah.
          </p>
          <p className="rounded-lg bg-[var(--bg)] px-3 py-2 text-[12.5px] text-[var(--ink-2)]">Verifikasi kantor &amp; MA yang sudah dibuat tetap disimpan dan langsung dipakai kalau file di-upload lagi.</p>
        </>
      )}
    </YDialog>
  );
}

export function ReopenYearButton({ year, rows, className }: { year: number; rows: number; className?: string }) {
  return (
    <YDialog label="Buka kembali" triggerClass={className ?? btnSm} title={`Buka kembali data ${year}?`} eyebrow="Kembali ke draft" submit={`Buka kembali ${year}`} danger pendingText="Menarik dari laporan…" action={reopenYearImport}>
      <input type="hidden" name="year" value={year} />
      <p className="text-[13px] text-[var(--ink-2)]">
        <b>{fmt(rows)} baris {year}</b> ditarik dari Data, GC, Top MA, dan Laporan, lalu data kembali menjadi <b>draft</b> supaya verifikasi kantor &amp; MA bisa diubah.
      </p>
      <p className="rounded-lg bg-[#FFF4DF] px-3 py-2 text-[12.5px] text-[#6B4000]">Selama draft, laporan {year} kosong. Setelah selesai, tekan <b>Simpan ke laporan</b> lagi.</p>
    </YDialog>
  );
}

// Bar bawah halaman Verifikasi: checklist + tombol Simpan ke laporan (aktif hanya kalau semua sudah terverifikasi).
export function FinalizeBar({ year, offices, pairs, rows, gc, otherLines }: { year: number; offices: number; pairs: number; rows: number; gc: number; otherLines: number }) {
  const ready = !offices && !pairs;
  return (
    <div className="no-print sticky bottom-0 z-20 -mx-6 mt-4 border-t border-[var(--line)] bg-white/95 px-6 py-3 shadow-[0_-6px_20px_rgba(16,24,40,.08)] backdrop-blur">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-2 max-sm:gap-y-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span className="mr-1 hidden text-[12px] font-semibold uppercase tracking-[.08em] text-[var(--muted)] sm:inline">Syarat simpan</span>
          <CheckItem ok={!offices}>Kantor: {offices ? `${fmt(offices)} belum` : "semua terhubung"}</CheckItem>
          <CheckItem ok={!pairs}>MA: {pairs ? `${fmt(pairs)} belum` : offices ? "menunggu kantor" : "semua terverifikasi"}</CheckItem>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-right text-[12px] leading-tight text-[var(--muted)] md:block">
            {ready ? <>{fmt(rows)} baris · GC {rupiah(gc)}<br />siap masuk laporan</> : <>Belum ada yang masuk laporan.<br />Selesaikan semua dulu.</>}
          </span>
          <YDialog label={`Simpan ${year} ke laporan`} triggerDisabled={!ready} triggerTitle={ready ? undefined : "Verifikasi semua kantor dan MA dulu"}
            triggerClass="rounded-lg bg-[var(--green)] px-4 py-2.5 font-display text-[14px] font-bold text-white shadow-sm hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--line)] disabled:text-[var(--muted)] disabled:shadow-none"
            title={`Simpan data ${year} ke laporan?`} eyebrow="Langkah 3 · Simpan" submit={`Simpan ${fmt(rows)} baris`} pendingText="Menyimpan ke laporan…" danger={otherLines > 0}
            action={finalizeYearImport}>
            <input type="hidden" name="year" value={year} />
            <p className="text-[13px] text-[var(--ink-2)]">
              Semua kantor dan MA sudah terverifikasi. <b>{fmt(rows)} baris</b> (GC {rupiah(gc)}) akan masuk sekaligus ke <b>Data, GC Office, Top MA, dan Laporan {year}</b>. Periode {year} yang belum ada dibuat dalam keadaan terkunci.
            </p>
            {otherLines > 0 ? (
              <div role="alert" className="rounded-[10px] border border-[#F5C2C7] bg-[var(--red-50)] px-3.5 py-3 text-[13px] text-[#8A0F1B]">
                <b className="block text-[14px]">Risiko laporan dobel: periode {year} sudah punya {fmt(otherLines)} baris lain</b>
                Baris itu dari Input Genius, Upload Excel, atau impor lama. Kalau isi file ini sama, Data, GC, Top MA, dan Laporan {year} akan terhitung <b>dua kali</b>.
                <label className="mt-2.5 flex items-start gap-2 rounded-lg bg-white px-3 py-2 font-medium text-[var(--ink)]">
                  <input type="checkbox" name="confirm_double" value="1" className="mt-0.5" required />
                  Saya sudah cek, file ini tidak berisi transaksi yang sama — tetap simpan
                </label>
              </div>
            ) : (
              <p className="rounded-lg bg-[var(--bg)] px-3 py-2 text-[12.5px] text-[var(--ink-2)]">Masih bisa diubah nanti lewat <b>Buka kembali</b> (baris ditarik lagi dari laporan).</p>
            )}
          </YDialog>
        </div>
      </div>
    </div>
  );
}
