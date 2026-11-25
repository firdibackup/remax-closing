import Link from "next/link";
import type { ReactNode } from "react";

// Alur Impor Data Tahunan (3 langkah) dipakai di /impor-tahunan dan /verifikasi supaya user selalu tahu posisinya:
//   1. Upload file → masuk DRAFT (belum ada yang masuk laporan)
//   2. Verifikasi kantor & MA
//   3. Simpan ke laporan (baru di sini semua baris masuk Data, GC, Top MA, Laporan)
// Komponen server (tanpa state), aman dirender dari halaman server.

type State = "done" | "current" | "todo";
const STEPS = [
  { title: "Upload file", desc: "Data masuk draft, belum masuk laporan" },
  { title: "Verifikasi kantor & MA", desc: "Hubungkan nama di file ke kantor dan Agent ID" },
  { title: "Simpan ke laporan", desc: "Semua baris masuk Data, GC, Top MA, Laporan" },
] as const;

// current: langkah yang sedang dikerjakan (1–3), atau 4 = semua selesai (data sudah tersimpan).
export function YearSteps({ current, year, hrefs }: { current: 1 | 2 | 3 | 4; year?: number | null; hrefs?: Partial<Record<1 | 2 | 3, string>> }) {
  return (
    <ol className="no-print mb-5 grid overflow-hidden rounded-xl border border-[var(--line)] bg-white sm:grid-cols-3" aria-label="Langkah impor data tahunan">
      {STEPS.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const state: State = n < current ? "done" : n === current ? "current" : "todo";
        const href = hrefs?.[n];
        const body = (
          <>
            <span className={`grid h-8 w-8 flex-none place-items-center rounded-full font-display text-[14px] font-extrabold ${
              state === "done" ? "bg-[var(--green)] text-white" : state === "current" ? "bg-[var(--blue)] text-white ring-4 ring-[var(--blue-50)]" : "bg-[var(--line-2)] text-[var(--muted)]"}`}>
              {state === "done" ? "✓" : n}
            </span>
            <span className="min-w-0">
              <span className={`block text-[11px] font-semibold uppercase tracking-[.08em] ${state === "current" ? "text-[var(--blue)]" : state === "done" ? "text-[var(--green)]" : "text-[#9AA1AD]"}`}>
                Langkah {n}{state === "current" ? " · sekarang" : state === "done" ? " · selesai" : ""}
              </span>
              <b className={`block font-display text-[15px] font-bold leading-snug ${state === "todo" ? "text-[var(--muted)]" : "text-[var(--ink)]"}`}>
                {s.title}{n === 2 && year ? ` ${year}` : ""}
              </b>
              <span className="block text-[12px] leading-snug text-[var(--muted)]">{s.desc}</span>
            </span>
          </>
        );
        const cls = `relative flex items-start gap-3 px-4 py-3.5 no-underline ${i ? "border-t border-[var(--line-2)] sm:border-l sm:border-t-0" : ""} ${state === "current" ? "bg-[var(--blue-50)]" : ""}`;
        return (
          <li key={n} aria-current={state === "current" ? "step" : undefined} className="contents">
            {href && state !== "current" ? <Link href={href} className={`${cls} hover:bg-[var(--bg)]`}>{body}</Link> : <div className={cls}>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

// Status satu impor tahunan: DRAFT (belum masuk laporan) / Tersimpan di laporan.
export function YearStatusBadge({ status, big }: { status: "draft" | "final" | null; big?: boolean }) {
  const size = big ? "px-2.5 py-1 text-[12px]" : "px-2 py-0.5 text-[11px]";
  return status === "final" ? (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#E7F5EE] font-bold uppercase tracking-[.04em] text-[var(--green)] ${size}`}>
      <i className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />Tersimpan di laporan
    </span>
  ) : (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[#FFF4DF] font-bold uppercase tracking-[.04em] text-[var(--amber)] ${size}`}>
      <i className="h-1.5 w-1.5 rounded-full bg-[var(--amber)]" />Draft · belum masuk laporan
    </span>
  );
}

// Satu baris checklist di bar Simpan.
export function CheckItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-[12px] font-semibold sm:px-2.5 sm:py-1.5 sm:text-[13px] ${ok ? "bg-[#E7F5EE] text-[var(--green)]" : "bg-[#FFF4DF] text-[var(--amber)]"}`}>
      <span className={`grid h-4 w-4 place-items-center rounded-full text-[10px] text-white ${ok ? "bg-[var(--green)]" : "bg-[var(--amber)]"}`} aria-hidden>{ok ? "✓" : "!"}</span>
      {children}
    </span>
  );
}
