import { Spinner } from "@/components/spinner";

// Halaman login tanpa menu samping: cukup spinner di tengah.
export default function Loading() {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--bg)] p-4" aria-busy="true">
      <span role="status" className="inline-flex items-center gap-2 text-[13px] text-[var(--muted)]"><Spinner />Memuat…</span>
    </main>
  );
}
