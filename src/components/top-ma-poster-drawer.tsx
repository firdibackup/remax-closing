import Link from "next/link";
import { Suspense } from "react";
import { loadPosterEntries } from "@/lib/top-ma/data";
import { PosterEditor, type PosterTemplate } from "@/components/top-ma-poster";
import { BULAN } from "@/components/ui";

// Drawer poster Top MA All Office di /top-ma (?poster=top10|top50). Dirender server seperti drawer Master;
// tutup = link tanpa ?poster. Isi dimuat di <Suspense> supaya tabel Top MA langsung tampil (foto bisa diambil dari Genius dulu).

const STEPS: { t: PosterTemplate; n: number; label: string; sub: string }[] = [
  { t: "top10", n: 1, label: "Top 10", sub: "Peringkat 1–10" },
  { t: "top50", n: 2, label: "Top 50", sub: "Peringkat 11–50" },
];

export function PosterDrawer({ template, month, role, year, closeHref, stepHref }: {
  template: PosterTemplate; month: number; role: string; year: number; closeHref: string; stepHref: (t: PosterTemplate) => string;
}) {
  const label = `${BULAN[month - 1]} ${year}`;
  const roleLabel = role === "agent_property" ? "Agent Property" : role === "franchise_owner" ? "Franchise Owner" : "Semua role";
  return (
    <>
      <Link href={closeHref} scroll={false} aria-label="Tutup poster" className="no-print fixed inset-0 z-40 bg-[rgba(15,20,25,.35)]" />
      <aside aria-label={`Poster Top MA ${year} All Office`} className="no-print fixed inset-y-0 right-0 z-50 flex w-[min(1180px,100%)] flex-col bg-[var(--bg)] shadow-[-20px_0_60px_rgba(0,0,0,.15)]">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-[var(--line)] bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[.08em] text-[var(--red)]">Top MA · poster · {roleLabel}</div>
            <h2 className="font-display text-[20px] font-extrabold leading-tight">Poster Top MA {year} All Office — {label}</h2>
          </div>
          <div className="flex items-center gap-3">
            <nav aria-label="Langkah poster">
              <ol className="flex items-center gap-1.5">
                {STEPS.map((s, i) => {
                  const on = s.t === template;
                  return (
                    <li key={s.t} className="flex items-center gap-1.5">
                      {i ? <span aria-hidden className="h-px w-5 bg-[var(--line)]" /> : null}
                      <Link href={stepHref(s.t)} scroll={false} aria-current={on ? "step" : undefined}
                        className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] font-semibold no-underline ${on ? "bg-[var(--blue-50)] text-[var(--blue-ink)]" : "text-[var(--muted)] hover:bg-[var(--line-2)] hover:text-[var(--ink)]"}`}>
                        <span className={`grid h-6 w-6 place-items-center rounded-full text-[12px] font-extrabold ${on ? "bg-[var(--blue)] text-white" : "bg-[var(--line-2)] text-[var(--ink-2)]"}`}>{s.n}</span>
                        <span>{s.label}<span className="ml-1 hidden font-normal text-[var(--muted)] sm:inline">· {s.sub}</span></span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
            </nav>
            <Link href={closeHref} scroll={false} aria-label="Tutup" className="rounded-lg px-2 py-1 text-[var(--muted)] no-underline hover:bg-[var(--line-2)]">✕</Link>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <Suspense key={template} fallback={<BodySkeleton />}>
            <PosterBody template={template} month={month} role={role} label={label}
              nextHref={template === "top10" ? stepHref("top50") : undefined} prevHref={template === "top50" ? stepHref("top10") : undefined} />
          </Suspense>
        </div>
      </aside>
    </>
  );
}

async function PosterBody({ template, month, role, label, nextHref, prevHref }: {
  template: PosterTemplate; month: number; role: string; label: string; nextHref?: string; prevHref?: string;
}) {
  const { entries, geniusErrors } = await loadPosterEntries({ month, role }, template);
  const filters = { t: template, bulan: String(month), ...(role ? { role } : {}) };
  return (
    <div className="flex flex-col gap-4">
      {geniusErrors.length ? (
        <div role="status" className="rounded-[10px] bg-[#FFF4DF] px-3.5 py-2.5 text-[13px] font-semibold text-[#6B4000]">
          Genius tidak bisa dihubungi untuk sebagian foto; muat ulang halaman nanti.
        </div>
      ) : null}
      {entries.length ? (
        <PosterEditor template={template} entries={entries} filters={filters} label={label} nextHref={nextHref} prevHref={prevHref} />
      ) : (
        <div className="rounded-xl border border-[var(--line)] bg-white p-10 text-center text-[var(--muted)]">
          <b className="block text-[var(--ink)]">Belum ada data</b>
          {template === "top50" ? `Belum ada MA di peringkat 11–50 untuk ${label}.` : `Belum ada MA closing di ${label}.`}
          {prevHref ? <div className="mt-4"><Link href={prevHref} scroll={false} className="font-semibold">← Kembali ke Top 10</Link></div> : null}
        </div>
      )}
    </div>
  );
}

function BodySkeleton() {
  return (
    <div role="status" aria-label="Memuat poster" className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,400px)]">
      <div className="flex flex-col gap-2 rounded-xl border border-[var(--line)] bg-white p-4">
        <div className="sk mb-2 h-5 w-48" />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 py-2">
            <div className="sk h-8 w-8 !rounded-full" />
            <div className="sk h-[72px] w-[54px]" />
            <div className="flex flex-1 flex-col gap-2"><div className="sk h-4 w-2/5" /><div className="sk h-8 w-full" /></div>
          </div>
        ))}
        <p className="mt-1 text-[12.5px] text-[var(--muted)]">Menyiapkan data &amp; foto… pertama kali bisa beberapa detik karena foto diambil dari Genius.</p>
      </div>
      <div className="rounded-xl border border-[var(--line)] bg-white p-4"><div className="sk aspect-[4018/5440] w-full" /></div>
    </div>
  );
}
