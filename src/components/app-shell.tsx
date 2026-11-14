"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { logout } from "@/app/actions/auth";
import { FINANCE_PATHS } from "@/lib/auth";
import { LinkPendingHint, SubmitButton, TopProgress } from "@/components/pending";

// Shell v8 (sidebar RE/MAX HQ). `ready: false` = halaman belum dibangun, tampil non-aktif dengan label "Segera".
type NavItem = { href: string; label: string; icon: keyof typeof ICONS; ready: boolean };

const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: "Kerja",
    items: [
      { href: "/", label: "Beranda", icon: "home", ready: true },
      { href: "/input", label: "Input Closing Genius", icon: "input", ready: true },
      { href: "/upload", label: "Upload Excel Kantor", icon: "upload", ready: true },
    ],
  },
  {
    group: "Laporan",
    items: [
      { href: "/laporan", label: "Laporan Bulanan", icon: "report", ready: true },
      { href: "/rekon", label: "Rekonsiliasi Finance", icon: "recon", ready: true },
      { href: "/data", label: "Data 2026", icon: "data", ready: true },
      { href: "/gc", label: "GC Office", icon: "gc", ready: true },
      { href: "/top-ma", label: "Top MA", icon: "top", ready: true },
    ],
  },
  {
    group: "Pengaturan",
    items: [
      { href: "/periode", label: "Periode & Cut-off", icon: "period", ready: true },
      { href: "/master", label: "Master Kantor & Agen", icon: "master", ready: true },
    ],
  },
];

const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  input: "M12 5v14M5 12h14",
  upload: "M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4",
  report: "M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6",
  recon: "M4 4h16v16H4zM8 12l3 3 5-6",
  data: "M3 5h18v14H3zM3 10h18M3 15h18M9 5v14",
  gc: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  top: "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
  period: "M4 5h16v16H4zM4 10h16M9 3v4M15 3v4",
  master: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
} as const;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px] flex-none opacity-80" aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-3 px-2 pb-5 pt-1">
      <span className="flex h-[38px] w-[10px] flex-col overflow-hidden rounded-[3px] ring-1 ring-[var(--line)]" aria-hidden>
        <i className="flex-1 bg-[var(--red)]" />
        <i className="flex-1 bg-white" />
        <i className="flex-1 bg-[var(--blue)]" />
      </span>
      <span>
        <b className="block font-display text-[19px] font-extrabold leading-none tracking-tight">
          RE/MAX <span className="text-[var(--red)]">HQ</span>
        </b>
        <small className="text-xs text-[var(--muted)]">Reporting Closing</small>
      </span>
    </div>
  );
}

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

// mode "finance" = link baca-saja: menu hanya Laporan & Rekon, tanpa tombol keluar.
export function AppShell({ children, mode, pending = 0 }: { children: ReactNode; mode: "admin" | "finance"; pending?: number }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  if (path === "/login") return <>{children}</>;
  const isFinance = mode === "finance";
  const nav = isFinance
    ? NAV.map((g) => ({ ...g, items: g.items.filter((it) => FINANCE_PATHS.includes(it.href)) })).filter((g) => g.items.length)
    : NAV;

  return (
    <div className="app-grid min-h-screen lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <TopProgress />
      <div className="no-print sticky top-0 z-30 flex items-center justify-between border-b border-[var(--line)] bg-white px-4 py-2 lg:hidden">
        <Brand />
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="side" className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium">
          Menu
        </button>
      </div>
      <aside
        id="side"
        className={`no-print ${open ? "fixed inset-0 z-40 flex" : "hidden"} flex-col overflow-auto border-r border-[var(--line)] bg-white px-3.5 py-5 lg:sticky lg:top-0 lg:flex lg:h-screen`}
      >
        <div className="flex items-start justify-between">
          <Brand />
          <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-sm lg:hidden" aria-label="Tutup menu">✕</button>
        </div>
        {nav.map(({ group, items }) => (
          <div key={group}>
            <div className="px-2.5 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-[.08em] text-[#9AA1AD]">{group}</div>
            <nav className="flex flex-col gap-0.5">
              {items.map((it) =>
                it.ready ? (
                  <Link
                    key={it.href}
                    href={it.href}
                    onClick={() => setOpen(false)}
                    aria-current={isActive(path, it.href) ? "page" : undefined}
                    className={`flex items-center gap-2.5 rounded-[9px] px-2.5 py-2 font-medium no-underline ${isActive(path, it.href) ? "bg-[var(--blue)] text-white" : "text-[var(--ink-2)] hover:bg-[var(--bg)]"}`}
                  >
                    <Icon name={it.icon} />
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    <LinkPendingHint />
                    {it.href === "/" && pending > 0 ? <span title="Kantor belum lapor di periode kerja" className="rounded-full bg-[var(--red)] px-[7px] py-px text-[11px] font-semibold text-white">{pending}</span> : null}
                  </Link>
                ) : (
                  <span key={it.href} className="flex cursor-not-allowed items-center gap-2.5 rounded-[9px] px-2.5 py-2 font-medium text-[#A3A9B4]" title="Halaman ini sedang dibangun">
                    <Icon name={it.icon} />
                    <span className="min-w-0 truncate">{it.label}</span>
                    <span className="ml-auto flex-none rounded-full bg-[var(--line-2)] px-2 text-[10.5px] font-semibold text-[var(--muted)]">Segera</span>
                  </span>
                ),
              )}
            </nav>
          </div>
        ))}
        <div className="mt-auto flex items-center gap-2.5 px-1.5 pt-4">
          <span className="grid h-[34px] w-[34px] place-items-center rounded-full bg-[var(--ink)] font-display text-xs font-bold text-white">{isFinance ? "FN" : "SA"}</span>
          <span className="min-w-0 flex-1">
            <b className="block text-[13px]">{isFinance ? "Finance" : "Superadmin"}</b>
            <small className="text-[11.5px] text-[var(--muted)]">{isFinance ? "Baca-saja" : "Admin HQ"}</small>
          </span>
          {isFinance ? null : (
            <form action={logout}>
              <SubmitButton pendingText="Keluar…" className="rounded-lg border border-[var(--line)] px-2.5 py-1 text-[12px] font-semibold text-[var(--ink-2)] hover:bg-[var(--bg)]">Keluar</SubmitButton>
            </form>
          )}
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
