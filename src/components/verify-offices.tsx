"use client";

import { memo, useRef, useState, type ReactNode, type RefObject } from "react";
import { resolveOffice } from "@/app/actions/yearly";
import { Field, inputCls } from "@/components/action-dialog";
import { Spinner } from "@/components/spinner";
import { Badge, Card, fmt, katLabel } from "@/components/ui";
import { Fold, YDialog, btnPriSm, smBtn, useRun } from "@/components/yearly-kit";
import type { OfficeIssue, OfficeSuggestion, ResolvedOffice } from "@/lib/yearly/data";

// Verifikasi bagian A: nama cabang di file → kantor master (pilih saran, kantor lain, atau buat kantor baru aktif/tutup).
// Hanya menyimpan peta nama; baris baru masuk laporan saat Simpan ke laporan. readOnly = impor sudah final.

const officeLabel = (o: OfficeSuggestion) => `${o.cabangName}${o.status !== "aktif" ? " (tutup)" : ""}`;

export function VerifyOffices({ offices, resolved, options, readOnly }: { offices: OfficeIssue[]; resolved: ResolvedOffice[]; options: OfficeSuggestion[]; readOnly?: boolean }) {
  return (
    <Card>
      <StepHead n="A" title="Kantor" done={!offices.length}
        desc={offices.length
          ? <>{fmt(offices.length)} nama cabang di file belum terhubung ke master kantor. Kerjakan ini dulu: nama MA di kantor ini baru muncul di bagian B setelah kantornya jelas.</>
          : <>Semua nama cabang di file sudah terhubung ke kantor.</>} />
      {offices.length ? (
        <div className="tw">
          <table className="t">
            <thead><tr><th>Cabang di file</th><th className="num">Baris</th><th className="num">GC</th><th className="num">MA</th><th className="min-w-[420px]">Hubungkan ke kantor</th></tr></thead>
            <tbody>{offices.map((o) => <OfficeRow key={o.nameKey} o={o} options={options} readOnly={readOnly} />)}</tbody>
          </table>
        </div>
      ) : null}
      {resolved.length ? (
        <Fold title="Sudah terhubung" count={resolved.length}>
          {() => (
            <div className="tw tall max-h-[420px]">
              <table className="t">
                <thead><tr><th>Cabang di file</th><th>Induk di file</th><th>Kantor</th><th>Sumber</th><th className="num">Baris</th><th className="num">GC</th></tr></thead>
                <tbody>
                  {resolved.map((o) => (
                    <tr key={o.nameKey}>
                      <td className="font-medium">{o.cabangRaw}</td>
                      <td className="text-[var(--muted)]">{o.indukRaw || "—"}</td>
                      <td><b>{o.cabangName}</b> <span className="text-[12px] text-[var(--muted)]">· {o.induk}</span>{o.status !== "aktif" ? <span className="ml-1.5"><Badge>Tutup</Badge></span> : null}</td>
                      <td>{o.source === "auto" ? <Badge tone="green">Otomatis</Badge> : <Badge tone="blue">HQ</Badge>}</td>
                      <td className="num">{fmt(o.rows)}</td>
                      <td className="num">{fmt(o.gc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Fold>
      ) : null}
    </Card>
  );
}

export function StepHead({ n, title, desc, done, aside }: { n: string; title: string; desc: ReactNode; done: boolean; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line-2)] px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`grid h-8 w-8 flex-none place-items-center rounded-full font-display text-[14px] font-extrabold ${done ? "bg-[#E7F5EE] text-[var(--green)]" : "bg-[var(--blue)] text-white"}`}>
          {done ? "✓" : n}
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-bold">{n}. {title}</h2>
          <div className="max-w-3xl text-[13px] text-[var(--ink-2)]">{desc}</div>
        </div>
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
    </div>
  );
}

const OfficeRow = memo(function OfficeRow({ o, options, readOnly }: { o: OfficeIssue; options: OfficeSuggestion[]; readOnly?: boolean }) {
  const [pending, run] = useRun();
  const [picking, setPicking] = useState(false);
  const [pick, setPick] = useState("");
  const newRef = useRef<HTMLDialogElement>(null);
  const [newStatus, setNewStatus] = useState<"tutup" | "aktif">("tutup");
  const openNew = () => { newRef.current?.querySelector("form")?.reset(); setNewStatus("tutup"); newRef.current?.showModal(); };
  const link = (officeId: string) => run(resolveOffice, { name_key: o.nameKey, office_id: officeId });
  return (
    <tr className={pending ? "opacity-60" : ""}>
      <td className="min-w-[180px] shadow-[inset_3px_0_0_var(--amber)]">
        <div className="font-semibold">{o.cabangRaw}</div>
        <div className="text-[12px] text-[var(--muted)]">Induk: {o.indukRaw || "—"}</div>
      </td>
      <td className="num">{fmt(o.rows)}</td>
      <td className="num font-semibold">{fmt(o.gc)}</td>
      <td className="num">{fmt(o.maNames)}</td>
      <td>
        {readOnly ? <div className="text-[12px] text-[var(--muted)]">Buka kembali impor untuk mengubah.</div> : o.suggestions.length ? (
          <>
            <div className="text-[11.5px] text-[var(--muted)]">Mungkin maksudnya:</div>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {o.suggestions.slice(0, 6).map((s) => (
                <button key={s.officeId} type="button" disabled={pending} onClick={() => link(s.officeId)} className={smBtn} title={`Induk ${s.induk} · ${katLabel(s.kategori)}`}>
                  {s.cabangName} <span className="font-normal text-[var(--muted)]">· {katLabel(s.kategori)}{s.status !== "aktif" ? " · tutup" : ""}</span>
                </button>
              ))}
            </div>
          </>
        ) : <div className="text-[11.5px] text-[var(--muted)]">Tidak ada nama kantor yang mirip.</div>}

        {picking && !readOnly ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <select autoFocus className={`${inputCls} !px-2 !py-1 !text-[12.5px] max-w-[280px]`} value={pick} disabled={pending} onChange={(e) => setPick(e.target.value)} aria-label={`Kantor untuk ${o.cabangRaw}`}>
              <option value="">— Pilih kantor —</option>
              {options.map((x) => <option key={x.officeId} value={x.officeId}>{officeLabel(x)} · {katLabel(x.kategori)}</option>)}
            </select>
            <button type="button" className={btnPriSm} disabled={!pick || pending} onClick={() => link(pick)}>Hubungkan</button>
            <button type="button" className={smBtn} disabled={pending} onClick={() => setPicking(false)}>Batal</button>
            <span className="w-full text-[11.5px] text-[var(--muted)]">Tidak ada di daftar? <button type="button" className="font-semibold text-[var(--blue)] hover:underline disabled:opacity-50" disabled={pending} onClick={openNew}>+ Buat kantor baru</button></span>
          </div>
        ) : null}

        {readOnly ? null : <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {picking ? null : <button type="button" className={smBtn} disabled={pending} onClick={() => setPicking(true)}>Pilih kantor lain</button>}
          <button type="button" className={`${smBtn} !border-[var(--blue-200)] !text-[var(--blue)]`} disabled={pending} onClick={openNew}>+ Buat kantor baru</button>
          {pending ? <Spinner className="h-3.5 w-3.5 text-[var(--blue)]" /> : null}
        </div>}
        {readOnly ? null : <NewOfficeDialog o={o} dialogRef={newRef} status={newStatus} setStatus={setNewStatus} />}
      </td>
    </tr>
  );
});

// Kantor baru di master: Tutup = kantor lama (hanya untuk data historis), Aktif = kantor yang masih jalan (wajib Office ID).
function NewOfficeDialog({ o, dialogRef, status, setStatus }: { o: OfficeIssue; dialogRef: RefObject<HTMLDialogElement | null>; status: "tutup" | "aktif"; setStatus: (s: "tutup" | "aktif") => void }) {
  const aktif = status === "aktif";
  return (
    <YDialog hideTrigger dialogRef={dialogRef} title={o.cabangRaw} eyebrow="Kantor baru" submit="Buat & hubungkan" action={resolveOffice}>
      <input type="hidden" name="name_key" value={o.nameKey} />
      <input type="hidden" name="mode" value="new" />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Nama cabang (REMAX)"><input name="cabang_name" defaultValue={o.cabangRaw} required className={inputCls} /></Field>
        <Field label="Office induk"><input name="induk_name" defaultValue={o.indukRaw || o.cabangRaw} required className={inputCls} /></Field>
        <Field label="Status" hint={aktif ? "Aktif = kantor yang masih berjalan, ikut tarik data Genius." : "Tutup = kantor lama, hanya untuk data historis."}>
          <select name="status" value={status} onChange={(e) => setStatus(e.target.value as "tutup" | "aktif")} className={inputCls}>
            <option value="tutup">Tutup (kantor lama)</option>
            <option value="aktif">Aktif</option>
          </select>
        </Field>
        <Field label="Kategori tarif" hint={o.inferredKategori ? `Ditebak dari royalti di file: ${katLabel(o.inferredKategori)}` : "Tidak bisa ditebak dari file, pilih manual."}>
          <select name="kategori" defaultValue={o.inferredKategori ?? ""} required className={inputCls}>
            <option value="">— pilih —</option>
            <option value="3.5">3,5% + PPN</option>
            <option value="9">9% + PPN</option>
          </select>
        </Field>
        <Field label={aktif ? "Office ID (wajib)" : "Office ID (opsional)"} hint={aktif ? "Wajib untuk kantor aktif, mis. F21xxx." : "Kosongkan kalau tidak tahu."}>
          <input name="office_code" placeholder="F21xxx" required={aktif} pattern="[A-Za-z0-9]{2,20}" className={`${inputCls} font-mono uppercase`} />
        </Field>
      </div>
      <p className="rounded-lg bg-[var(--blue-50)] px-3 py-2 text-[12.5px] text-[var(--blue-ink)]">
        Kantor ditambahkan ke master dengan status <b>{aktif ? "Aktif" : "Tutup"}</b>, lalu “{o.cabangRaw}” ({fmt(o.rows)} baris) dihubungkan ke kantor ini dan dihitung dengan tarif kategorinya saat disimpan ke laporan. Cek dulu: kalau kantornya sudah ada dengan nama lain, pakai <b>Pilih kantor lain</b>.
      </p>
    </YDialog>
  );
}
