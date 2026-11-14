"use client";

import { startTransition, useActionState, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ActionResult } from "@/lib/closing/audit";
import { useReportPending } from "@/components/pending";
import { PendingButton } from "@/components/spinner";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

// Tombol + dialog v8 berisi form server action. Pesan sukses/gagal tampil di dialog; sukses menutup dialog.
export function ActionDialog({ label, title, eyebrow, action, submit, danger, children, triggerClass, pendingText }: {
  label: ReactNode; title: string; eyebrow?: string; action: Action; submit: string; danger?: boolean; children: ReactNode; triggerClass?: string; pendingText?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(action, null);
  useReportPending(pending);
  // Selama proses berjalan dialog tidak bisa ditutup (Esc / ✕ / Kembali) supaya hasilnya tetap terlihat.
  const close = () => {
    if (!pending) ref.current?.close();
  };
  const [dismissed, setDismissed] = useState<ActionResult>(null);
  useEffect(() => {
    if (!state?.ok) return;
    ref.current?.close();
    const t = setTimeout(() => setDismissed(state), 4000);
    return () => clearTimeout(t);
  }, [state]);
  const flash = state?.ok && dismissed !== state ? state.message : null;
  // Submit manual (bukan <form action>) supaya React tidak mengosongkan isian saat simpan gagal.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };

  return (
    <>
      <button type="button" onClick={() => ref.current?.showModal()} className={triggerClass ?? "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[12.5px] font-semibold hover:bg-[var(--bg)]"}>{label}</button>
      <dialog ref={ref} onCancel={(e) => { if (pending) e.preventDefault(); }} className="m-auto whitespace-normal text-left font-normal w-[min(560px,calc(100vw-24px))] rounded-2xl border border-[var(--line)] p-0 shadow-2xl backdrop:bg-black/30">
        <form onSubmit={onSubmit} aria-busy={pending || undefined} className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              {eyebrow ? <div className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--red)]">{eyebrow}</div> : null}
              <h2 className="font-display text-xl font-extrabold">{title}</h2>
            </div>
            <button type="button" onClick={close} disabled={pending} aria-label="Tutup" className="rounded-lg px-2 py-1 text-[var(--muted)] disabled:opacity-40">✕</button>
          </div>
          <fieldset disabled={pending} className="contents">{children}</fieldset>
          {state && !state.ok ? <div role="alert" className="rounded-lg bg-[var(--red-50)] px-3 py-2 text-[13px] text-[var(--red)]">{state.message}</div> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} disabled={pending} className="rounded-lg border border-[var(--line)] bg-white px-3.5 py-2 text-[13.5px] font-semibold disabled:opacity-50">Kembali</button>
            <PendingButton type="submit" pending={pending} pendingText={pendingText ?? (danger ? "Memproses…" : "Menyimpan…")} className={`rounded-lg px-3.5 py-2 text-[13.5px] font-semibold text-white ${danger ? "bg-[var(--red)]" : "bg-[var(--blue)]"}`}>{submit}</PendingButton>
          </div>
        </form>
      </dialog>
      {flash ? <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-xl bg-[var(--ink)] px-4 py-3 text-[13px] text-white shadow-xl">{flash}</div> : null}
    </>
  );
}

// Field form v8.
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-[var(--ink-2)]">
      {label}
      {children}
      {hint ? <span className="font-normal text-[var(--muted)]">{hint}</span> : null}
    </label>
  );
}
export const inputCls = "rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[13.5px] font-normal text-[var(--ink)]";
