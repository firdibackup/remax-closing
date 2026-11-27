"use client";

import { startTransition, useActionState, useEffect, useRef, useState, useTransition, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { commitYearImport, previewYearFile, type YearPreview } from "@/app/actions/yearly";
import { Field, inputCls } from "@/components/action-dialog";
import { useReportPending } from "@/components/pending";
import { PendingButton, Spinner } from "@/components/spinner";
import { Alert, Ic } from "@/components/upload-form";
import { BULAN, Badge, Card, btnCls, btnPriCls, rupiah, fmt, fmtWib } from "@/components/ui";

// Langkah 1 Impor Data Tahunan: pilih file → Pratinjau (tidak menyimpan) → "Lanjut ke verifikasi" menyimpan DRAFT
// (file yang sama dikirim ulang) lalu langsung pindah ke halaman Verifikasi. Belum ada baris yang masuk laporan.
const ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_BYTES = 10 * 1024 * 1024;

export function YearImportForm() {
  const [preview, previewAction, reading] = useActionState(previewYearFile, null);
  const [commit, commitAction, saving] = useActionState(commitYearImport, null);
  const [file, setFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState("");
  const [year, setYear] = useState("");
  const [over, setOver] = useState(false);
  const [hint, setHint] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [savedFor, setSavedFor] = useState<YearPreview>(null); // pratinjau yang dikirim ke Simpan
  const sentYear = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [going, go] = useTransition(); // pindah ke Verifikasi setelah draft tersimpan
  const pending = reading || saving || going;
  useReportPending(pending);
  useEffect(() => {
    if (commit?.ok && commit.year) go(() => router.push(`/verifikasi?tahun=${commit.year}`));
  }, [commit, router]);

  const formOf = (f: File, next: { sheet?: string; year?: string } = {}) => {
    const fd = new FormData();
    fd.set("file", f);
    const s = next.sheet ?? sheet, y = next.year ?? year;
    if (s) fd.set("sheet", s);
    if (y) fd.set("year", y);
    sentYear.current = y;
    return fd;
  };
  // Kirim manual (bukan <form action>) supaya file pilihan tetap ada untuk Simpan.
  const read = (f: File | null = file, next: { sheet?: string; year?: string } = {}) => {
    if (!f || pending) return;
    setConfirmReplace(false);
    setHidden(false);
    startTransition(() => previewAction(formOf(f, next)));
  };
  const save = (p: NonNullable<YearPreview>) => {
    if (!file || pending) return;
    const fd = formOf(file, { sheet: p.sheet ?? sheet, year: p.year ? String(p.year) : year });
    if (confirmReplace) fd.set("confirm_replace", "1");
    setSavedFor(p);
    startTransition(() => commitAction(fd));
  };
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) { setHint("File harus .xlsx. File .xls lama: buka di Excel lalu Save As .xlsx."); return; }
    if (f.size > MAX_BYTES) { setHint("File lebih dari 10 MB."); return; }
    setHint("");
    setFile(f);
    setSheet("");
    read(f, { sheet: "" });
  };
  const onDrag = (e: DragEvent, on: boolean) => { e.preventDefault(); if (!pending) setOver(on); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!pending) pick(e.dataTransfer.files[0]); };

  const p = hidden ? null : preview;
  // Hasil simpan hanya relevan untuk pratinjau yang sedang tampil.
  const forThis = !!p?.ok && savedFor === preview;
  const saved = commit?.ok && forThis ? commit : null;
  const saveFail = commit && !commit.ok && forThis ? commit.message : null;

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="flex flex-col gap-3.5 p-5">
        <div>
          <h2 className="font-display text-[16px] font-bold">Upload Master Data</h2>
          <p className="mt-0.5 text-[12.5px] text-[var(--muted)]">Satu file = satu tahun. Sheet bernama tahun (mis. <b className="text-[var(--ink)]">2025</b>) dibaca otomatis.</p>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" disabled={pending} aria-busy={pending || undefined} onClick={() => inputRef.current?.click()}
          onDragEnter={(e) => onDrag(e, true)} onDragOver={(e) => onDrag(e, true)} onDragLeave={(e) => onDrag(e, false)} onDrop={onDrop}
          className={`flex flex-col items-center rounded-xl border-2 border-dashed px-5 py-7 text-center transition ${
            pending ? "cursor-wait border-[var(--blue-200)] bg-[var(--blue-50)]"
            : over ? "border-[var(--blue)] bg-[#E5EDFB]" : "border-[var(--blue-200)] bg-[var(--blue-50)] hover:border-[var(--blue)] hover:bg-[#E5EDFB]"}`}>
          {pending ? <Spinner className="h-7 w-7 text-[var(--blue)]" /> : <Ic name="upload" className="h-7 w-7 text-[var(--blue)]" />}
          <b className="mb-0.5 mt-2 block font-display text-[16px] font-bold text-[var(--ink)]">{reading ? "Membaca file…" : saving ? "Menyimpan draft…" : going ? "Membuka Verifikasi…" : "Tarik file .xlsx ke sini"}</b>
          <span className="text-[13px] text-[var(--muted)]">{reading ? "±4.000 baris, tunggu sebentar" : saving || going ? "Mencocokkan kantor & MA otomatis" : "atau klik untuk memilih · maks. 10 MB"}</span>
        </button>
        {hint ? <div role="alert" className="-mt-1.5 text-[12.5px] font-medium text-[var(--red)]">{hint}</div> : null}

        {file ? (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-[12.5px]">
            <Ic name="file" className="h-4 w-4 text-[var(--muted)]" />
            <span className="min-w-0 flex-1 truncate font-medium" title={file.name}>{file.name}</span>
            <PendingButton type="button" pending={reading} pendingText="Membaca…" disabled={pending} onClick={() => read()}
              className={`${btnCls} !px-2.5 !py-1 !text-[12.5px]`}>Baca ulang</PendingButton>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-2.5">
          <Field label="Sheet">
            <select className={inputCls} value={sheet} disabled={pending || !preview?.sheets?.length}
              onChange={(e) => { setSheet(e.target.value); read(file, { sheet: e.target.value }); }}>
              <option value="">Otomatis</option>
              {(preview?.sheets ?? []).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Tahun">
            <input className={`${inputCls} tabular-nums`} inputMode="numeric" maxLength={4} placeholder="dari nama sheet" value={year} disabled={pending}
              onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))} onBlur={() => { if (file && (year.length === 4 || !year) && year !== sentYear.current) read(); }} />
          </Field>
        </div>
        <p className="-mt-1.5 text-[12px] text-[var(--muted)]">Isi tahun hanya kalau nama sheet bukan tahun.</p>

        <Alert lv="blue">
          Upload <b>belum memasukkan data ke laporan</b>. Data disimpan sebagai draft, lalu Anda verifikasi kantor &amp; MA. Laporan baru terisi setelah <b>Simpan ke laporan</b>. Komisi dihitung ulang dengan tarif kantor (angka di file hanya pembanding).
        </Alert>
      </Card>

      <div className={`flex min-w-0 flex-col gap-4 transition-opacity ${reading ? "opacity-60" : ""}`}>
        {p && !p.ok ? (
          <Card className="p-5">
            <Alert lv="red">
              <b>{p.message}</b>
              {p.errors?.length ? <ul className="mt-1 list-disc pl-5">{p.errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul> : null}
            </Alert>
          </Card>
        ) : null}
        {!p ? (
          <Card className="px-5 py-12 text-center text-[var(--muted)]">
            {reading ? <span className="inline-flex items-center gap-2"><Spinner />Membaca file…</span>
              : <><b className="block text-[var(--ink)]">Belum ada file</b>Pilih file Master Data satu tahun. Pratinjau tidak menyimpan apa pun.</>}
          </Card>
        ) : p.ok ? (
          <Preview p={p} saving={saving || going} busy={pending} saved={saved} saveFail={saveFail}
            confirmReplace={confirmReplace} setConfirmReplace={setConfirmReplace}
            onSave={() => save(p)} onClose={() => setHidden(true)} />
        ) : null}
      </div>
    </div>
  );
}

type PreviewProps = {
  p: NonNullable<YearPreview>; saving: boolean; busy: boolean;
  saved: Awaited<ReturnType<typeof commitYearImport>>; saveFail: string | null;
  confirmReplace: boolean; setConfirmReplace: (v: boolean) => void;
  onSave: () => void; onClose: () => void;
};

function Preview({ p, saving, busy, saved, saveFail, confirmReplace, setConfirmReplace, onSave, onClose }: PreviewProps) {
  const rows = p.rows ?? 0, off = p.offices, ag = p.agents, auto = p.publishable ?? 0;
  const check = rows - auto;
  const needReplace = !!p.exists, wasFinal = p.exists?.status === "final", otherLines = p.otherLines ?? 0;
  const blocked = needReplace && !confirmReplace;
  // Peringatan dobel tampil sebagai kotak sendiri; jangan diulang di daftar catatan.
  const issues = (p.errors ?? []).filter((e) => !(otherLines && /sumber lain/.test(e)));
  const [allIssues, setAllIssues] = useState(false);
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line-2)] px-5 py-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[.08em] text-[var(--red)]">Pratinjau · belum disimpan</div>
          <h2 className="truncate font-display text-[19px] font-extrabold" title={p.fileName}>Data {p.year} · sheet “{p.sheet}”</h2>
          <div className="truncate text-[12.5px] text-[var(--muted)]">{p.fileName}</div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" className={`${btnCls} disabled:opacity-50`} disabled={busy} onClick={onClose}>Tutup</button>
          {saved ? (
            <Link href={`/verifikasi?tahun=${p.year}`} className={btnPriCls}>Buka Verifikasi {p.year} →</Link>
          ) : (
            <PendingButton type="button" pending={saving} pendingText="Menyimpan draft…" disabled={blocked || busy} onClick={onSave}
              title={blocked ? "Centang konfirmasi dulu" : "Simpan sebagai draft lalu lanjut ke verifikasi. Belum masuk laporan."}
              className={`${btnPriCls} disabled:!bg-[var(--blue-200)] disabled:opacity-100`}>
              {needReplace ? `Ganti draft ${p.year} & lanjut verifikasi →` : `Lanjut ke verifikasi →`}
            </PendingButton>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-5 pt-4 empty:hidden">
        {saved ? (
          <Alert lv="green">
            <b>{saved.message}</b>
            <div className="mt-0.5">Membuka halaman Verifikasi… Kalau tidak pindah otomatis, <Link href={`/verifikasi?tahun=${p.year}`} className="font-semibold text-[#0B5333] underline">klik di sini</Link>.</div>
          </Alert>
        ) : null}
        {saveFail ? <Alert lv="red"><b>{saveFail}</b></Alert> : null}

        {needReplace && !saved ? (
          <div className={`rounded-[10px] px-3.5 py-3 text-[13px] ${wasFinal ? "border border-[#F5C2C7] bg-[var(--red-50)] text-[#8A0F1B]" : "bg-[#FFF4DF] text-[#6B4000]"}`} role={wasFinal ? "alert" : undefined}>
            <div className="flex items-start gap-2.5">
              <span className="mt-px"><Ic name="warn" /></span>
              <div>
                {wasFinal ? (
                  <>
                    <b className="block text-[14px]">Data {p.year} sudah tersimpan di laporan</b>
                    ({p.exists?.sourceFile ?? "file"}, {fmt(p.exists?.rows ?? 0)} baris, {p.exists ? fmtWib(p.exists.createdAt) : ""}). Mengganti file akan <b>menarik semua baris {p.year} dari Data, GC, Top MA, dan Laporan</b>. Laporan {p.year} kosong sampai draft baru diverifikasi dan disimpan lagi.
                  </>
                ) : (
                  <>
                    <b>Sudah ada draft {p.year}</b> ({p.exists?.sourceFile ?? "file"}, {fmt(p.exists?.rows ?? 0)} baris, {p.exists ? fmtWib(p.exists.createdAt) : ""}). Draft lama diganti file ini. Verifikasi kantor &amp; MA yang sudah dibuat tetap dipakai.
                  </>
                )}
              </div>
            </div>
            <label className="mt-2.5 flex items-start gap-2 rounded-lg bg-white px-3 py-2 font-medium text-[var(--ink)]">
              <input type="checkbox" className="mt-0.5" checked={confirmReplace} disabled={busy} onChange={(e) => setConfirmReplace(e.target.checked)} />
              {wasFinal ? `Ya, tarik data ${p.year} dari laporan dan ganti dengan file ini` : `Ganti draft ${p.year} yang lama dengan file ini`}
            </label>
          </div>
        ) : null}

        {otherLines > 0 && !saved ? (
          <Alert lv="amber">
            <b>Periode {p.year} sudah punya {fmt(otherLines)} baris lain</b> (Input Genius, Upload Excel, atau impor lama). Kalau isinya sama dengan file ini, laporan bisa dobel. Anda akan diminta konfirmasi lagi saat <b>Simpan ke laporan</b>.
          </Alert>
        ) : null}
      </div>

      <div className="grid gap-2.5 p-5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Baris terbaca" value={fmt(rows)} sub={`${fmt(p.skipped ?? 0)} dilewati (MA kosong / komisi 0)`} />
        <Stat label="Total GC" value={rupiah(p.totals?.gc ?? 0)} sub={`Nilai transaksi ${rupiah(p.totals?.nilai ?? 0)}`} />
        <Stat label="Kantor cocok otomatis" value={`${fmt(off?.matched ?? 0)} / ${fmt(off?.names ?? 0)}`} sub={`${fmt(off?.rowsMatched ?? 0)} baris`} tone={off && off.matched < off.names ? "amber" : "green"} />
        <Stat label="MA cocok otomatis" value={`${fmt(ag?.matched ?? 0)} / ${fmt(ag?.pairs ?? 0)}`} sub="di kantor yang sudah cocok" tone={ag && ag.matched < ag.pairs ? "amber" : "green"} />
      </div>

      <div className="mx-5 mb-4 overflow-hidden rounded-[10px] border border-[var(--line-2)]">
        <div className="flex h-2.5 bg-[var(--line-2)]" aria-hidden>
          <span className="bg-[var(--green)]" style={{ width: `${rows ? (auto / rows) * 100 : 0}%` }} />
          <span className="bg-[#F2C46B]" style={{ width: `${rows ? (check / rows) * 100 : 0}%` }} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 px-3.5 py-2.5 text-[12.5px]">
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[var(--green)]" /><b>{fmt(auto)}</b> baris kantor &amp; MA-nya cocok otomatis</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-[#F2C46B]" /><b>{fmt(check)}</b> baris perlu diverifikasi</span>
          <span className="text-[var(--muted)]">Semua baris (termasuk yang cocok otomatis) baru masuk laporan setelah Simpan di langkah 3.</span>
        </div>
      </div>

      <div className="grid gap-4 px-5 pb-5 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div>
          <h3 className="mb-2 font-display text-[15px] font-bold">Per bulan</h3>
          <div className="tw rounded-lg border border-[var(--line-2)]">
            <table className="t">
              <thead><tr><th>Bulan</th><th className="num">Baris</th><th className="num">GC</th></tr></thead>
              <tbody>{(p.months ?? []).map((m) => <tr key={m.month}><td>{BULAN[m.month - 1]}</td><td className="num">{fmt(m.rows)}</td><td className="num">{fmt(m.gc)}</td></tr>)}</tbody>
              <tfoot><tr><td>Total</td><td className="num">{fmt(rows)}</td><td className="num">{fmt(p.totals?.gc ?? 0)}</td></tr></tfoot>
            </table>
          </div>
        </div>
        <div>
          <h3 className="mb-2 flex items-center gap-2 font-display text-[15px] font-bold">
            Kantor belum cocok {off?.unmatched.length ? <Badge tone="amber">{off.unmatched.length}</Badge> : <Badge tone="green">Semua cocok</Badge>}
          </h3>
          {off?.unmatched.length ? (
            <>
              <div className="tw tall max-h-[360px] rounded-lg border border-[var(--line-2)]">
                <table className="t">
                  <thead><tr><th>Cabang di file</th><th>Induk di file</th><th className="num">Baris</th></tr></thead>
                  <tbody>{off.unmatched.map((o) => <tr key={`${o.cabangRaw}|${o.indukRaw}`}><td className="font-medium">{o.cabangRaw}</td><td className="text-[var(--muted)]">{o.indukRaw || "—"}</td><td className="num">{fmt(o.rows)}</td></tr>)}</tbody>
                </table>
              </div>
              <p className="mt-1.5 text-[12px] text-[var(--muted)]">Nama cabang ini dihubungkan ke kantor yang ada, atau dibuat kantor historis, di langkah Verifikasi.</p>
            </>
          ) : <p className="text-[13px] text-[var(--muted)]">Semua nama cabang di file sudah terhubung ke master kantor.</p>}
        </div>
      </div>

      {issues.length ? (
        <div className="border-t border-[var(--line-2)] px-5 py-4">
          <h3 className="mb-2 font-display text-[15px] font-bold">Catatan baca file <span className="font-normal text-[var(--muted)]">({fmt(issues.length)})</span></h3>
          <ul className="flex flex-col gap-1 text-[12.5px] text-[var(--amber)]">
            {(allIssues ? issues : issues.slice(0, 8)).map((e, i) => <li key={i}>⚠ {e}</li>)}
          </ul>
          {issues.length > 8 ? <button type="button" onClick={() => setAllIssues((v) => !v)} className="mt-1.5 text-[12.5px] font-semibold text-[var(--blue)] hover:underline">{allIssues ? "Ringkas" : `Lihat semua ${fmt(issues.length)}`}</button> : null}
        </div>
      ) : null}
    </Card>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "green" | "amber" }) {
  return (
    <div className="rounded-[10px] bg-[var(--bg)] p-3">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <b className={`font-display text-[20px] font-extrabold tabular-nums ${tone === "amber" ? "text-[var(--amber)]" : tone === "green" ? "text-[var(--green)]" : ""}`}>{value}</b>
      {sub ? <div className="text-[12px] text-[var(--muted)]">{sub}</div> : null}
    </div>
  );
}
