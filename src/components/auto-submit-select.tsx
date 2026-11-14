"use client";

import type { ComponentProps } from "react";
import { useNavFormPending } from "@/components/pending";
import { Spinner } from "@/components/spinner";

// <select> di form GET yang langsung mengirim form saat diganti (pilih periode/filter tanpa tombol).
// Di dalam <NavForm> tampil spinner kecil selama halaman baru dimuat.
export function AutoSubmitSelect({ className = "", ...props }: ComponentProps<"select">) {
  const pending = useNavFormPending();
  return (
    <span className="relative inline-flex">
      <select {...props} aria-busy={pending || undefined} className={`${className} ${pending ? "cursor-wait pr-8 opacity-70" : ""}`} onChange={(e) => e.currentTarget.form?.requestSubmit()} />
      {pending ? <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--blue)]"><Spinner /></span> : null}
    </span>
  );
}
