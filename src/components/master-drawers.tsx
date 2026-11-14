import Link from "next/link";
import type { ReactNode } from "react";
import { AgentForm, DeleteAgentButton, DeleteOfficeButton, OfficeForm, UndoTransferButton } from "@/components/admin-forms";
import { ContactForm, ContactLinks, DeleteContact } from "@/components/contact-forms";
import { Badge, compact, fmt, fmtDate, katLabel, periodLabel } from "@/components/ui";
import type { Contact } from "@/lib/closing/contacts";
import type { LineRow } from "@/lib/supabase/fetch-lines";

// Panel detail Master (mockup: drawer kantor & agen). Dirender server lewat ?open=<id>; tutup = link tanpa ?open.
export type OfficeRow = { id: string; alamat: string | null; office_code: string; induk_name: string; cabang_name: string; kategori: string; status: string; report_channel: string | null };
export type AgentRow = { id: string; employee_code: string; name: string; full_name: string | null; sheet_name: string | null; aliases?: string[] | null; role: string; status: string };
export type Assignment = { agent_id: string; office_id: string; start_date: string; end_date: string | null; alasan: string };

const RECENT = 8;
const AGENTS_PREVIEW = 10;
const btnSm = "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[12.5px] font-semibold text-[var(--ink)] no-underline hover:bg-[var(--bg)]";
const btnPriSm = "rounded-lg bg-[var(--blue)] px-2.5 py-1 text-[12.5px] font-semibold text-white no-underline hover:bg-[var(--blue-ink)]";
export const roleBadge = (r: string) => (r === "franchise_owner" ? <Badge tone="red">Franchise Owner</Badge> : <Badge tone="blue">Agent Property</Badge>);
export const statusBadge = (s: string) => (/aktif/i.test(s) ? <Badge tone="green">Aktif</Badge> : <Badge>{s === "resign" ? "Resign" : s === "tutup" ? "Tutup" : s}</Badge>);
const sumGc = (ls: LineRow[]) => ls.reduce((a, l) => a + (Number(l.komisi_gross) || 0), 0);

function Drawer({ closeHref, eyebrow, title, chips, children }: { closeHref: string; eyebrow: ReactNode; title: string; chips: ReactNode; children: ReactNode }) {
  return (
    <>
      <Link href={closeHref} scroll={false} aria-label="Tutup detail" className="no-print fixed inset-0 z-40 bg-[rgba(15,20,25,.35)]" />
      <aside aria-label={title} className="fixed inset-y-0 right-0 z-50 flex w-[min(460px,100%)] flex-col bg-white shadow-[-20px_0_60px_rgba(0,0,0,.15)]">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--line-2)] px-5 py-4">
          <div className="min-w-0">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[.08em] text-[var(--red)]">{eyebrow}</div>
            <h2 className="font-display text-[19px] font-extrabold leading-tight">{title}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">{chips}</div>
          </div>
          <Link href={closeHref} scroll={false} aria-label="Tutup" className="rounded-lg px-2 py-1 text-[var(--muted)] no-underline">✕</Link>
        </div>
        <div className="flex flex-col gap-5 overflow-auto px-5 py-4">{children}</div>
      </aside>
    </>
  );
}

const Section = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <section>
    <div className="mb-2 flex items-center justify-between gap-2"><h3 className="font-display text-[15px] font-bold">{title}</h3>{aside}</div>
    {children}
  </section>
);

const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) => (
  <div className="rounded-[10px] bg-[var(--bg)] p-3"><div className="text-[12px] text-[var(--muted)]">{label}</div><b className="font-display text-[20px] font-extrabold">{value}</b>{sub ? <div className="text-[12px] text-[var(--muted)]">{sub}</div> : null}</div>
);

export function OfficeDrawer({ o, closeHref, contacts, activeAgents, lines, agentsEver, agentHref }: {
  o: OfficeRow; closeHref: string; contacts: Contact[]; activeAgents: AgentRow[]; lines: LineRow[]; agentsEver: number; agentHref: (id: string) => string;
}) {
  const fo = activeAgents.filter((a) => a.role === "franchise_owner");
  return (
    <Drawer closeHref={closeHref} eyebrow={`${o.office_code || "Tanpa Office ID"} · ${o.induk_name}`} title={o.cabang_name}
      chips={<><Badge>{katLabel(o.kategori)} + PPN</Badge>{o.report_channel === "EXCEL" ? <Badge tone="green">Lapor via Excel</Badge> : <Badge tone="blue">Lapor via Genius</Badge>}{statusBadge(o.status)}</>}>
      <div className="flex flex-wrap gap-2">
        <OfficeForm office={{ ...o, report_channel: o.report_channel ?? "GENIUS" }} label="Edit kantor" triggerClass={btnPriSm} />
        {/aktif/i.test(o.status) || !(lines.length || agentsEver) ? <DeleteOfficeButton id={o.id} name={o.cabang_name} lines={lines.length} agents={agentsEver} /> : null}
      </div>
      <Section title="Alamat"><div className="text-[var(--ink-2)]">{o.alamat || <span className="text-[var(--muted)]">Belum diisi</span>}</div></Section>
      <Section title="Kontak" aside={<ContactForm officeId={o.id} cabang={o.cabang_name} label="+ Kontak" />}>
        {contacts.length ? (
          <div className="grid gap-2">
            {contacts.map((c) => (
              <div key={c.id} className="rounded-[10px] border border-[var(--line)] px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5"><ContactLinks contact={c} />{c.is_primary ? <Badge tone="blue">Utama</Badge> : null}</div>
                {c.email ? <a href={`mailto:${c.email}`} className="text-[12.5px] text-[var(--muted)]">{c.email}</a> : null}
                {c.catatan ? <div className="text-[12px] text-[var(--muted)]">{c.catatan}</div> : null}
                <div className="mt-1.5 flex gap-1.5"><ContactForm contact={c} officeId={o.id} cabang={o.cabang_name} label="Ubah" /><DeleteContact id={c.id} name={c.nama ?? c.jenis} /></div>
              </div>
            ))}
          </div>
        ) : <div className="text-[var(--muted)]">Belum ada kontak. Admin wajib punya nomor untuk follow up.</div>}
      </Section>
      <Section title="Franchise Owner">
        {fo.length ? <div className="flex flex-wrap gap-1.5">{fo.map((a) => <Link key={a.id} href={agentHref(a.id)} className="rounded-lg border border-[var(--line)] px-2 py-0.5 text-[12.5px] text-[var(--ink)] no-underline">{a.full_name || a.name}</Link>)}</div>
          : <span className="text-[var(--muted)]">Belum ada agen ber-role Franchise Owner.</span>}
      </Section>
      <div className="grid grid-cols-2 gap-2.5">
        <Stat label="Agen aktif" value={activeAgents.length} />
        <Stat label="Transaksi 2026" value={fmt(lines.length)} sub={`GC ${compact(sumGc(lines))}`} />
      </div>
      <Section title="Agen" aside={<Link href={`/master?tab=agen&cab=${o.id}`} className="text-[12.5px]">Lihat semua</Link>}>
        {activeAgents.length ? activeAgents.slice(0, AGENTS_PREVIEW).map((a) => (
          <div key={a.id} className="flex justify-between border-b border-[var(--line-2)] py-1.5">
            <Link href={agentHref(a.id)} className="text-[var(--ink)] no-underline">{a.full_name || a.name}</Link>
            {a.role === "franchise_owner" ? <Badge tone="red">FO</Badge> : null}
          </div>
        )) : <span className="text-[var(--muted)]">Belum ada agen.</span>}
      </Section>
    </Drawer>
  );
}

export function AgentDrawer({ a, closeHref, history, officeName, lines, officeHref }: {
  a: AgentRow; closeHref: string; history: Assignment[]; officeName: (id: string) => string; lines: LineRow[]; officeHref: (id: string) => string;
}) {
  const last = history.at(-1);
  const prev = history.at(-2);
  const systemLinesAtLast = last ? lines.filter((l) => l.cabang_id === last.office_id && l.source !== "import").length : 0;
  const canUndo = !!prev && last?.alasan === "transfer" && systemLinesAtLast === 0;
  const perOffice = [...new Set(history.map((h) => h.office_id))].map((id) => ({ id, ls: lines.filter((l) => l.cabang_id === id) }));
  // Baris impor tidak punya tanggal transaksi: urut periode dulu, lalu tanggal.
  const sortKey = (l: LineRow) => `${l.periods?.year ?? 0}-${String(l.periods?.month ?? 0).padStart(2, "0")}|${l.tanggal_transaksi ?? ""}`;
  const recent = [...lines].sort((x, y) => sortKey(y).localeCompare(sortKey(x))).slice(0, RECENT);
  return (
    <Drawer closeHref={closeHref} eyebrow={a.employee_code || "Tanpa Agent ID"} title={a.full_name || a.name}
      chips={<>{roleBadge(a.role)}{statusBadge(a.status)}{prev ? <Badge tone="blue">⇄ Pindahan</Badge> : null}</>}>
      <div className="flex flex-wrap items-center gap-2">
        <AgentForm agent={a} offices={[]} label="Edit" triggerClass={btnPriSm} />
        {/aktif/i.test(a.status) ? <Link href={`/transfer?agent=${a.id}`} className={btnSm}>Pindah kantor</Link> : null}
        {/aktif/i.test(a.status) || !lines.length ? <DeleteAgentButton id={a.id} name={a.full_name || a.name} lines={lines.length} /> : null}
      </div>
      <table className="t">
        <tbody>
          <tr><td className="w-[130px] text-[var(--muted)]">Nama panggilan</td><td>{a.name}</td></tr>
          <tr><td className="text-[var(--muted)]">Nama di laporan</td><td>{a.sheet_name || "—"}</td></tr>
          <tr><td className="text-[var(--muted)]">Nama lain (dari file)</td><td>{a.aliases?.length ? a.aliases.join(", ") : "—"}</td></tr>
          <tr><td className="text-[var(--muted)]">Kantor saat ini</td><td>{last ? <Link href={officeHref(last.office_id)} className="font-semibold text-[var(--ink)] no-underline">{officeName(last.office_id)}</Link> : "—"}</td></tr>
        </tbody>
      </table>
      <Section title="Riwayat kantor">
        <ol className="ml-1.5 border-l-2 border-[var(--line)] pl-4">
          {[...history].reverse().map((h, i) => (
            <li key={`${h.office_id}-${h.start_date}`} className="relative pb-3">
              <span className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 ${i === 0 ? "border-[var(--blue)] bg-[var(--blue)]" : "border-[#C9CED6] bg-white"}`} />
              <b>{officeName(h.office_id)}</b>{i === 0 ? <span className="ml-1.5"><Badge tone="green">sekarang</Badge></span> : null}
              <div className="text-[12.5px] text-[var(--muted)]">{fmtDate(h.start_date)} — {h.end_date ? fmtDate(h.end_date) : "sekarang"}{h.alasan !== "awal" ? ` · ${h.alasan}` : ""}</div>
            </li>
          ))}
        </ol>
        {canUndo && prev ? <UndoTransferButton agentId={a.id} name={a.full_name || a.name} backTo={officeName(prev.office_id)} /> : null}
      </Section>
      <Section title="Transaksi per kantor">
        <p className="mb-2 text-[12.5px] text-[var(--muted)]">Transaksi dihitung untuk kantor tempat agen bernaung pada tanggal transaksi. Pindah kantor tidak memindahkan transaksi lama.</p>
        <table className="t">
          <thead><tr><th>Kantor</th><th className="num">Transaksi</th><th className="num">GC</th></tr></thead>
          <tbody>{perOffice.map(({ id, ls }) => <tr key={id}><td>{officeName(id)}</td><td className="num">{ls.length}</td><td className="num">{fmt(sumGc(ls))}</td></tr>)}</tbody>
        </table>
      </Section>
      <Section title="Transaksi terakhir">
        {recent.length ? recent.map((l) => (
          <div key={l.id} className="flex justify-between gap-2.5 border-b border-[var(--line-2)] py-1.5 text-[13px]">
            <span className="min-w-0"><b>{l.periods ? periodLabel(l.periods) : "—"}</b> · {l.offices?.cabang_name}<span className="block truncate text-[11.5px] text-[var(--muted)]">{l.alamat ?? ""}{l.tanggal_transaksi ? ` · ${fmtDate(l.tanggal_transaksi)}` : ""}</span></span>
            <span className="tabular-nums">{fmt(Number(l.komisi_gross) || 0)}</span>
          </div>
        )) : <span className="text-[var(--muted)]">Belum ada transaksi.</span>}
      </Section>
    </Drawer>
  );
}
