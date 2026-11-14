"use client";

import { createContext, use, useEffect, useState, useSyncExternalStore, useTransition, type ComponentProps, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { useLinkStatus } from "next/link";
import { PendingButton, Spinner } from "@/components/spinner";

// --- Bar progres tipis di atas layar: menyala selama ada navigasi/aksi yang sedang berjalan. ---
let active = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

// Laporkan status proses ke bar progres global.
export function useReportPending(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    active += 1;
    emit();
    return () => {
      active -= 1;
      emit();
    };
  }, [pending]);
}

export function TopProgress() {
  const busy = useSyncExternalStore(subscribe, () => active > 0, () => false);
  return (
    <div aria-hidden className={`top-progress no-print ${busy ? "is-busy" : ""}`}>
      <span />
    </div>
  );
}

// --- Tombol submit untuk form server action (<form action={serverAction}>). ---
export function SubmitButton({ pendingText = "Memproses…", ...props }: ComponentProps<"button"> & { pendingText?: ReactNode }) {
  const { pending } = useFormStatus();
  useReportPending(pending);
  return <PendingButton type="submit" pending={pending} pendingText={pendingText} {...props} />;
}

// --- Form GET (filter) yang bernavigasi lewat router supaya status proses bisa ditampilkan. ---
const NavPending = createContext(false);
export const useNavFormPending = () => use(NavPending);

export function NavForm({ action, children, ...props }: Omit<ComponentProps<"form">, "action" | "onSubmit" | "method"> & { action: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useReportPending(pending);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (pending) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const qs = new URLSearchParams();
    for (const [k, v] of new FormData(e.currentTarget, submitter)) if (typeof v === "string") qs.append(k, v);
    const s = qs.toString();
    start(() => router.push(s ? `${action}?${s}` : action));
  };
  return (
    <NavPending value={pending}>
      <form {...props} action={action} onSubmit={onSubmit} aria-busy={pending || undefined}>{children}</form>
    </NavPending>
  );
}

// Tombol submit di dalam NavForm.
export function NavSubmit({ pendingText = "Memuat…", ...props }: ComponentProps<"button"> & { pendingText?: ReactNode }) {
  const pending = useNavFormPending();
  return <PendingButton type="submit" pending={pending} pendingText={pendingText} {...props} />;
}

// --- Indikator di dalam <Link> (menu samping). Ukuran tetap supaya tidak menggeser tata letak. ---
export function LinkPendingHint() {
  const { pending } = useLinkStatus();
  useReportPending(pending);
  return (
    <span aria-hidden className={`link-hint grid h-3.5 w-3.5 flex-none place-items-center ${pending ? "is-pending" : ""}`}>
      {pending ? <Spinner className="h-3.5 w-3.5" /> : null}
    </span>
  );
}

// --- Tombol unduh .xlsx: ambil file lewat fetch supaya status "Menyiapkan…" tampil sampai file siap. ---
const fileName = (cd: string | null, fallback: string) => {
  const star = cd?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star);
    } catch {}
  }
  return cd?.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
};

export function DownloadButton({ href, children = "Unduh .xlsx", className }: { href: string; children?: ReactNode; className?: string }) {
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useReportPending(pending);
  const onClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setErr(null);
    try {
      const res = await fetch(href, { credentials: "same-origin" });
      if (!res.ok) throw new Error((await res.text()) || `Gagal mengunduh (${res.status}).`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName(res.headers.get("Content-Disposition"), "unduhan.xlsx");
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (x) {
      setErr(x instanceof Error ? x.message.slice(0, 200) : "Gagal mengunduh.");
    } finally {
      setPending(false);
    }
  };
  return (
    <span className="relative inline-flex">
      <a href={href} onClick={onClick} aria-busy={pending || undefined} aria-disabled={pending || undefined}
        className={`inline-flex items-center gap-2 ${pending ? "pointer-events-none cursor-wait opacity-70" : ""} ${className ?? ""}`}>
        {pending ? <Spinner /> : null}
        {pending ? "Menyiapkan…" : children}
      </a>
      {err ? <span role="alert" className="absolute right-0 top-full z-10 mt-1 w-max max-w-[260px] rounded-lg bg-[var(--red-50)] px-2.5 py-1.5 text-[12px] text-[var(--red)] shadow">{err}</span> : null}
    </span>
  );
}
