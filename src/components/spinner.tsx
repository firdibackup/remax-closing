import type { ComponentProps, ReactNode } from "react";

// Spinner kecil mengikuti warna teks (currentColor). Dengan prefers-reduced-motion tidak berputar; teks "…" tetap memberi tanda.
export function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={`flex-none animate-spin motion-reduce:animate-none ${className}`}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// Tombol dengan status proses: spinner + teks proses + nonaktif. Dipakai semua tombol aksi lewat pembungkus di pending.tsx.
export function PendingButton({ pending, pendingText, children, className = "", disabled, ...props }: ComponentProps<"button"> & { pending: boolean; pendingText?: ReactNode }) {
  return (
    <button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      data-pending={pending || undefined}
      className={`inline-flex items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-70 ${pending ? "cursor-wait" : ""} ${className}`}
    >
      {pending ? <Spinner /> : null}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
