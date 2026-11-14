import Link from "next/link";
import type { ReactNode } from "react";

// Komponen tampilan v8 (header halaman, kartu, KPI, badge). Dipakai semua halaman supaya seragam dengan mockup.

export const fmt = (n: number) => new Intl.NumberFormat("id-ID").format(Math.round(n));

// Ringkas untuk KPI: Rp33,5 M / Rp12,4 jt.
export function compact(n: number) {
  const a = Math.abs(n);
  if (a >= 1e9) return `Rp${(n / 1e9).toLocaleString("id-ID", { maximumFractionDigits: 1 })} M`;
  if (a >= 1e6) return `Rp${(n / 1e6).toLocaleString("id-ID", { maximumFractionDigits: 1 })} jt`;
  return `Rp${fmt(n)}`;
}

export function PageHeader({ eyebrow, title, desc, actions }: { eyebrow: ReactNode; title: ReactNode; desc?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-[.08em] text-[var(--red)]">{eyebrow}</div>
        <h1 className="font-display text-[clamp(26px,3vw,34px)] font-extrabold leading-tight tracking-tight">{title}</h1>
        {desc ? <p className="mt-1.5 max-w-2xl text-[var(--ink-2)]">{desc}</p> : null}
      </div>
      {actions ? <div className="no-print flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(16,24,40,.05),0_1px_3px_rgba(16,24,40,.06)] ${className}`}>{children}</div>;
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[12.5px] font-medium text-[var(--muted)]">{label}</div>
      <div className="mt-1 font-display text-[26px] font-extrabold leading-tight tracking-tight tabular-nums">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-[var(--muted)]">{sub}</div> : null}
    </Card>
  );
}

const TONES = {
  blue: "bg-[var(--blue-50)] text-[var(--blue-ink)]",
  green: "bg-[#E7F5EE] text-[var(--green)]",
  red: "bg-[var(--red-50)] text-[var(--red)]",
  amber: "bg-[#FFF4DF] text-[var(--amber)]",
  gray: "bg-[var(--line-2)] text-[var(--ink-2)]",
} as const;

export function Badge({ tone = "gray", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${TONES[tone]}`}>{children}</span>;
}

export const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// Tab segmen v8 berbasis link (server-friendly).
export function Seg({ items }: { items: { href: string; label: ReactNode; on: boolean }[] }) {
  return (
    <div className="no-print inline-flex rounded-[10px] bg-[var(--line-2)] p-1">
      {items.map((it) => (
        <Link key={it.href} href={it.href} aria-current={it.on ? "page" : undefined}
          className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold no-underline ${it.on ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>
          {it.label}
        </Link>
      ))}
    </div>
  );
}

export const selectCls = "rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-[13.5px]";
export const btnCls = "rounded-lg border border-[var(--line)] bg-white px-3.5 py-2 text-[13.5px] font-semibold text-[var(--ink)] no-underline hover:bg-[var(--bg)]";
export const btnPriCls = "rounded-lg bg-[var(--blue)] px-3.5 py-2 text-[13.5px] font-semibold text-white no-underline hover:bg-[var(--blue-ink)]";

export const katLabel = (k: string | null | undefined) => (k === "9" ? "9%" : k === "3.5" ? "3,5%" : "—");

const PERIOD_BADGE = { open: ["green", "Terbuka"], locked: ["red", "Terkunci"], future: ["gray", "Belum mulai"] } as const;
export function PeriodBadge({ state }: { state: keyof typeof PERIOD_BADGE }) {
  const [tone, text] = PERIOD_BADGE[state];
  return <Badge tone={tone}>{text}</Badge>;
}

export const periodLabel = (p: { month: number; year: number }) => `${BULAN[p.month - 1]} ${p.year}`;

// Tanggal & jam WIB, mis. "20 Nov 2026 10.04".
export const fmtWib = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

// Tanggal transaksi (yyyy-mm-dd) → "1 Okt 2026".
export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—";

const SOURCE_BADGE: Record<string, [keyof typeof TONES, string]> = { import: ["gray", "Impor Master"], genius: ["blue", "Genius"], excel: ["green", "Excel"], manual: ["gray", "Manual"] };
export function SourceBadge({ source }: { source: string }) {
  const [tone, text] = SOURCE_BADGE[source] ?? ["gray", source];
  return <Badge tone={tone}>{text}</Badge>;
}
