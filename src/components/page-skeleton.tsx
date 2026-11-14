import { Card } from "@/components/ui";
import { Spinner } from "@/components/spinner";

// Kerangka halaman saat data dimuat (dipakai loading.tsx). Bentuk mengikuti v8: header, KPI, filter, tabel.
const Bar = ({ className }: { className: string }) => <div className={`sk ${className}`} />;

export function PageSkeleton({ kpis = 4, filters = 0, rows = 8, cols = 6, side = false, label = "Memuat data…" }: {
  kpis?: number; filters?: number; rows?: number; cols?: number; side?: boolean; label?: string;
}) {
  const table = (
    <Card className="overflow-hidden">
      <div className="flex gap-4 border-b border-[var(--line)] bg-[#fafbfc] px-4 py-3">
        {Array.from({ length: cols }, (_, i) => <Bar key={i} className={`h-3 ${i === 0 ? "w-32" : "w-16"}`} />)}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-[var(--line-2)] px-4 py-3.5 last:border-0">
          {Array.from({ length: cols }, (_, i) => <Bar key={i} className={`h-3 ${i === 0 ? (r % 2 ? "w-28" : "w-40") : "w-16"}`} />)}
        </div>
      ))}
    </Card>
  );
  return (
    <main className="mx-auto max-w-[1400px] p-6" aria-busy="true">
      <div role="status" className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Bar className="mb-2.5 h-3 w-28 !bg-[var(--red-50)]" />
          <Bar className="h-8 w-[min(360px,70vw)]" />
          <Bar className="mt-2.5 h-3.5 w-[min(520px,80vw)]" />
        </div>
        <span className="inline-flex items-center gap-2 text-[12.5px] font-medium text-[var(--muted)]"><Spinner />{label}</span>
      </div>
      {kpis ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: kpis }, (_, i) => (
            <Card key={i} className="px-5 py-4"><Bar className="h-3 w-24" /><Bar className="mt-2.5 h-6 w-32" /><Bar className="mt-2 h-2.5 w-20" /></Card>
          ))}
        </div>
      ) : null}
      {filters ? (
        <div className="mb-4 flex flex-wrap gap-2.5">
          {Array.from({ length: filters }, (_, i) => <Bar key={i} className={`h-9 ${i === filters - 1 ? "w-24 !bg-[var(--blue-50)]" : "w-40"}`} />)}
        </div>
      ) : null}
      {side ? (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="grid gap-3 p-5"><Bar className="h-3 w-28" /><Bar className="h-9 w-full" /><Bar className="h-3 w-32" /><Bar className="h-36 w-full" /><Bar className="h-9 w-36 !bg-[var(--blue-50)]" /></Card>
          {table}
        </div>
      ) : table}
    </main>
  );
}
