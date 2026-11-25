"use client";

import { useRef, useState, useSyncExternalStore, useTransition, type FormEvent, type ReactNode, type RefObject } from "react";
import type { AgentCreateResult, YearlyResult } from "@/app/actions/yearly";
import { useReportPending } from "@/components/pending";
import { PendingButton } from "@/components/spinner";

// Perlengkapan halaman Impor Data Tahunan & Verifikasi. Setelah aksi berhasil server memuat ulang halaman dan baris
// yang diverifikasi hilang dari daftar, jadi pesan hasil ditampilkan lewat toast global (bukan di baris itu sendiri).

export const smBtn = "rounded-lg border border-[var(--line)] bg-white px-2 py-0.5 text-[11.5px] font-semibold text-[var(--ink)] hover:bg-[var(--bg)] disabled:opacity-50";
export const btnSm = "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[12.5px] font-semibold text-[var(--ink)] no-underline hover:bg-[var(--bg)] disabled:opacity-50";
export const btnPriSm = "rounded-lg bg-[var(--blue)] px-2.5 py-1 text-[12.5px] font-semibold text-white no-underline hover:bg-[var(--blue-ink)] disabled:opacity-50";
export const dangerSm = "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[12.5px] font-semibold text-[var(--red)] hover:bg-[var(--red-50)] disabled:opacity-50";

// --- Toast ---
type Toast = { id: number; ok: boolean; message: string };
let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => void listeners.delete(l); };
const dismiss = (id: number) => { toasts = toasts.filter((t) => t.id !== id); emit(); };
const EMPTY: Toast[] = [];

export function notify(r: YearlyResult) {
  if (!r) return;
  const t = { id: ++seq, ok: r.ok, message: r.message };
  toasts = [...toasts.slice(-2), t];
  emit();
  setTimeout(() => dismiss(t.id), r.ok ? 6000 : 12000);
}

// lift: naikkan toast di atas bar aksi yang menempel di bawah layar (halaman Verifikasi).
export function Toasts({ lift }: { lift?: boolean }) {
  const list = useSyncExternalStore(subscribe, () => toasts, () => EMPTY);
  if (!list.length) return null;
  return (
    <div className={`no-print fixed ${lift ? "bottom-28 sm:bottom-24" : "bottom-5"} left-1/2 z-[60] flex w-[min(560px,calc(100vw-24px))] -translate-x-1/2 flex-col gap-2`}>
      {list.map((t) => (
        <div key={t.id} role={t.ok ? "status" : "alert"}
          className={`flex items-start gap-3 rounded-xl px-4 py-3 text-[13px] shadow-xl ${t.ok ? "bg-[var(--ink)] text-white" : "bg-[var(--red)] text-white"}`}>
          <span className="min-w-0 flex-1">{t.message}</span>
          <button type="button" onClick={() => dismiss(t.id)} aria-label="Tutup" className="-mr-1 rounded px-1 opacity-70 hover:opacity-100">✕</button>
        </div>
      ))}
    </div>
  );
}

// --- Menjalankan server action (prev, fd) langsung, hasilnya ke toast. ---
type Act<R> = (prev: R, fd: FormData) => Promise<R>;
const toFd = (data: Record<string, string> | FormData) => {
  if (data instanceof FormData) return data;
  const fd = new FormData();
  for (const [k, v] of Object.entries(data)) fd.set(k, v);
  return fd;
};

export function useRun() {
  const [pending, start] = useTransition();
  useReportPending(pending);
  const run = <R extends YearlyResult>(action: Act<R>, data: Record<string, string> | FormData, after?: (r: R) => void) => {
    if (pending) return;
    start(async () => {
      let r: R;
      try {
        r = await action(null as R, toFd(data));
      } catch {
        r = { ok: false, message: "Gagal menghubungi server. Muat ulang halaman lalu coba lagi." } as R;
      }
      notify(r);
      after?.(r);
    });
  };
  return [pending, run] as const;
}

// --- Dialog form (tampilan sama dengan ActionDialog). Sukses: dialog tutup + toast. Gagal: pesan di dialog. ---
export function YDialog({ label, triggerClass, triggerDisabled, triggerTitle, title, eyebrow, submit, danger, pendingText, action, children, dialogRef, failExtra, hideTrigger, wide }: {
  label?: ReactNode; triggerClass?: string; triggerDisabled?: boolean; triggerTitle?: string; title: string; eyebrow?: string; submit: string; danger?: boolean; pendingText?: string;
  action: Act<AgentCreateResult>; children: ReactNode; dialogRef?: RefObject<HTMLDialogElement | null>;
  failExtra?: (r: NonNullable<AgentCreateResult>) => ReactNode; hideTrigger?: boolean; wide?: boolean;
}) {
  const own = useRef<HTMLDialogElement>(null);
  const ref = dialogRef ?? own;
  const [pending, start] = useTransition();
  const [fail, setFail] = useState<NonNullable<AgentCreateResult> | null>(null);
  useReportPending(pending);
  const close = () => { if (!pending) ref.current?.close(); };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    start(async () => {
      let r: AgentCreateResult;
      try { r = await action(null, fd); } catch { r = { ok: false, message: "Gagal menghubungi server. Muat ulang halaman lalu coba lagi." }; }
      if (r?.ok) { setFail(null); ref.current?.close(); notify(r); } else setFail(r);
    });
  };
  return (
    <>
      {hideTrigger ? null : (
        <button type="button" disabled={triggerDisabled} title={triggerTitle}
          onClick={() => { setFail(null); ref.current?.querySelector("form")?.reset(); ref.current?.showModal(); }} className={triggerClass ?? btnSm}>{label}</button>
      )}
      <dialog ref={ref} onCancel={(e) => { if (pending) e.preventDefault(); }}
        className={`m-auto whitespace-normal rounded-2xl border border-[var(--line)] p-0 text-left font-normal shadow-2xl backdrop:bg-black/30 ${wide ? "w-[min(720px,calc(100vw-24px))]" : "w-[min(560px,calc(100vw-24px))]"}`}>
        <form onSubmit={onSubmit} aria-busy={pending || undefined} className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {eyebrow ? <div className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--red)]">{eyebrow}</div> : null}
              <h2 className="break-words font-display text-xl font-extrabold">{title}</h2>
            </div>
            <button type="button" onClick={close} disabled={pending} aria-label="Tutup" className="rounded-lg px-2 py-1 text-[var(--muted)] disabled:opacity-40">✕</button>
          </div>
          <fieldset disabled={pending} className="contents">{children}</fieldset>
          {fail ? (
            <div role="alert" className="rounded-lg bg-[var(--red-50)] px-3 py-2 text-[13px] text-[var(--red)]">
              {fail.message}
              {failExtra ? <div className="mt-1.5">{failExtra(fail)}</div> : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} disabled={pending} className="rounded-lg border border-[var(--line)] bg-white px-3.5 py-2 text-[13.5px] font-semibold disabled:opacity-50">Kembali</button>
            <PendingButton type="submit" pending={pending} pendingText={pendingText ?? (danger ? "Memproses…" : "Menyimpan…")}
              className={`rounded-lg px-3.5 py-2 text-[13.5px] font-semibold text-white ${danger ? "bg-[var(--red)]" : "bg-[var(--blue)]"}`}>{submit}</PendingButton>
          </div>
        </form>
      </dialog>
    </>
  );
}

// Lipatan "Sudah terhubung / Sudah terverifikasi": isinya baru dirender saat dibuka (daftarnya bisa ribuan).
export function Fold({ title, count, children }: { title: string; count: number; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-[var(--line-2)]">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-3 text-left text-[13px] font-semibold text-[var(--ink-2)] hover:bg-[#fafbfc]">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden
          className={`h-4 w-4 flex-none transition-transform ${open ? "rotate-90" : ""}`}><path d="M9 6l6 6-6 6" /></svg>
        {title} <span className="font-normal text-[var(--muted)]">({count.toLocaleString("id-ID")})</span>
      </button>
      {open ? children() : null}
    </div>
  );
}

// Dibulatkan ke bawah supaya 0,949 tidak tampil "95%" padahal tidak ikut "Terima saran ≥ 95%".
export const pctScore = (s: number) => `${Math.floor(s * 100 + 1e-6)}%`;
export const SHORT_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const monthsLabel = (ms: number[]) => (ms.length === 12 ? "Jan–Des" : ms.map((m) => SHORT_BULAN[m - 1]).join(", "));
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
