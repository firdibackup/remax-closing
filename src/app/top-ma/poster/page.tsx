import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { loadYear } from "@/lib/closing/period-data";
import { loadPosterEntries, parseRole } from "@/lib/top-ma/data";
import { PosterEditor, type PosterTemplate } from "@/components/top-ma-poster";
import { BULAN } from "@/components/ui";

// Poster Top MA All Office (halaman penuh): /top-ma/poster?tahun=&bulan=&role=&t=top10|top50.
// Dua langkah: Top 10 lalu Top 50. Isi dimuat di <Suspense> karena foto bisa diambil dari Genius dulu.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ tahun?: string; bulan?: string; role?: string; t?: string }> };

const STEPS: { t: PosterTemplate; n: number; label: string; sub: string }[] = [
  { t: "top10", n: 1, label: "Top 10", sub: "Peringkat 1–10" },
  { t: "top50", n: 2, label: "Top 50", sub: "Peringkat 11–50" },
];

export default async function TopMaPosterPage({ searchParams }: Props) {
  const sp = await searchParams;
  const month = Number(sp.bulan);
  const role = parseRole(sp.role);
  // Tahun dari ?tahun= (default: tahun terakhir yang sudah mulai), dari daftar periode yang di-cache.
  const { year } = await loadYear(sp.tahun);
  const roleQs: Record<string, string> = { tahun: String(year), ...(role ? { role } : {}) };
  // Poster hanya per bulan; tanpa bulan valid kembali ke tabel Top MA.
  if (!Number.isInteger(month) || month < 1 || month > 12) redirect(`/top-ma?${new URLSearchParams(roleQs)}`);
  const template: PosterTemplate = sp.t === "top50" ? "top50" : "top10";
  const roleLabel = role === "agent_property" ? "Agent Property" : role === "franchise_owner" ? "Franchise Owner" : "Semua role";
  const stepHref = (t: PosterTemplate) => `/top-ma/poster?${new URLSearchParams({ bulan: String(month), ...roleQs, t })}`;
  const backHref = `/top-ma?${new URLSearchParams({ bulan: String(month), ...roleQs })}`;

  return (
    <main className="mx-auto max-w-[1280px] p-6">
      <Link href={backHref} className="no-print mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--muted)] no-underline hover:text-[var(--ink)]">
        ← Kembali ke Top MA
      </Link>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-[.08em] text-[var(--red)]">Top MA · poster · {roleLabel}</div>
          <h1 className="font-display text-[clamp(24px,2.6vw,32px)] font-extrabold leading-tight tracking-tight">Poster Top MA {year} All Office — {BULAN[month - 1]} {year}</h1>
        </div>
        <nav aria-label="Langkah poster" className="no-print">
          <ol className="flex items-center gap-1.5">
            {STEPS.map((s, i) => {
              const on = s.t === template;
              return (
                <li key={s.t} className="flex items-center gap-1.5">
                  {i ? <span aria-hidden className="h-px w-5 bg-[var(--line)]" /> : null}
                  <Link href={stepHref(s.t)} aria-current={on ? "step" : undefined}
                    className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] font-semibold no-underline ${on ? "bg-[var(--blue-50)] text-[var(--blue-ink)]" : "text-[var(--muted)] hover:bg-[var(--line-2)] hover:text-[var(--ink)]"}`}>
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-[12px] font-extrabold ${on ? "bg-[var(--blue)] text-white" : "bg-[var(--line-2)] text-[var(--ink-2)]"}`}>{s.n}</span>
                    <span>{s.label}<span className="ml-1 hidden font-normal text-[var(--muted)] sm:inline">· {s.sub}</span></span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
      <Suspense key={template} fallback={<BodySkeleton template={template} />}>
        <PosterBody template={template} year={year} month={month} role={role}
          nextHref={template === "top10" ? stepHref("top50") : undefined} prevHref={template === "top50" ? stepHref("top10") : undefined} />
      </Suspense>
    </main>
  );
}

async function PosterBody({ template, year, month, role, nextHref, prevHref }: {
  template: PosterTemplate; year: number; month: number; role: string; nextHref?: string; prevHref?: string;
}) {
  const { entries, geniusErrors } = await loadPosterEntries({ year, month, role }, template);
  const label = `${BULAN[month - 1]} ${year}`;
  const filters = { t: template, tahun: String(year), bulan: String(month), ...(role ? { role } : {}) };
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
          {prevHref ? <div className="mt-4"><Link href={prevHref} className="font-semibold">← Kembali ke Top 10</Link></div> : null}
        </div>
      )}
    </div>
  );
}

function BodySkeleton({ template }: { template: PosterTemplate }) {
  return (
    <div role="status" aria-label="Memuat poster" className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
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
      <div className="rounded-xl border border-[var(--line)] bg-white p-4">
        <div className={`sk w-full ${template === "top50" ? "aspect-[4018/7857] lg:max-h-[calc(100vh-260px)]" : "aspect-[4018/5440]"}`} />
      </div>
    </div>
  );
}
