import Link from "next/link";
import { loadPosterEntries, parseRole } from "@/lib/top-ma/data";
import { PosterEditor } from "@/components/top-ma-poster";
import { BULAN, Card, PageHeader, btnCls } from "@/components/ui";

// Poster Top 10 MA per bulan: cek foto (Genius / upload manual), ubah teks, pratinjau, lalu unduh PNG/JPG.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ bulan?: string; ind?: string; role?: string }> };

export default async function TopMaPosterPage({ searchParams }: Props) {
  const sp = await searchParams;
  const month = Number(sp.bulan);
  const role = parseRole(sp.role);
  const ind = sp.ind || undefined;
  const filters = { ...(Number.isInteger(month) && month >= 1 && month <= 12 ? { bulan: String(month) } : {}), ...(ind ? { ind } : {}), ...(role ? { role } : {}) };
  const back = `/top-ma?${new URLSearchParams(filters)}`;
  const backLink = <Link href={back} className={btnCls}>← Kembali ke Top MA</Link>;

  if (!filters.bulan) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <PageHeader eyebrow="Top MA · poster" title="Poster Top 10 MA" actions={backLink} />
        <Card className="p-10 text-center text-[var(--muted)]">
          <b className="block text-[var(--ink)]">Bulan belum dipilih</b>
          Poster dibuat per bulan. Pilih satu bulan di halaman Top MA, lalu klik “Poster Top 10”.
          <div className="mt-4"><Link href="/top-ma" className={btnCls}>Buka Top MA</Link></div>
        </Card>
      </main>
    );
  }

  const { year, entries, geniusErrors } = await loadPosterEntries({ month, ind, role });
  const label = `${BULAN[month - 1]} ${year}`;
  const scope = [ind ?? "Semua office", role === "agent_property" ? "Agent Property" : role === "franchise_owner" ? "Franchise Owner" : null].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto max-w-7xl p-6">
      <PageHeader eyebrow="Top MA · poster" title={`Poster Top 10 MA — ${label}`}
        desc={<>Cek foto tiap MA, rapikan nama di poster, lalu unduh. <span className="text-[var(--muted)]">Filter: {scope}.</span></>}
        actions={backLink} />
      {geniusErrors.length ? (
        <div role="status" className="mb-4 rounded-[10px] bg-[#FFF4DF] px-3.5 py-2.5 text-[13px] text-[#6B4000]">
          <b>Genius tidak bisa dihubungi untuk sebagian foto; muat ulang halaman nanti.</b>
        </div>
      ) : null}
      {entries.length ? (
        <PosterEditor entries={entries} filters={filters} label={label} />
      ) : (
        <Card className="p-10 text-center text-[var(--muted)]">
          <b className="block text-[var(--ink)]">Belum ada data</b>
          Belum ada MA closing di {label} untuk filter ini, jadi poster belum bisa dibuat.
        </Card>
      )}
    </main>
  );
}
