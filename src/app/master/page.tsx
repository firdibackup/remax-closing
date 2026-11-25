import Link from "next/link";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { fetchActiveLines, type LineRow } from "@/lib/supabase/fetch-lines";
import { AgentForm, OfficeForm } from "@/components/admin-forms";
import { ContactLinks } from "@/components/contact-forms";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { AgentDrawer, OfficeDrawer, roleBadge, statusBadge, type AgentRow, type Assignment, type OfficeRow } from "@/components/master-drawers";
import { loadContacts, pickPrimary } from "@/lib/closing/contacts";
import { Badge, Card, Kpi, PageHeader, Seg, btnCls, btnPriCls, fmt, fmtDate, katLabel, selectCls } from "@/components/ui";
import { NavForm, NavSubmit } from "@/components/pending";
import { loadYear } from "@/lib/closing/period-data";

// Master Kantor & Agen (mockup v8): tabel + filter, panel detail lewat ?open=<id>. Agen & kantor tidak pernah dibuat otomatis.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ tab?: string; q?: string; st?: string; role?: string; ast?: string; cab?: string; open?: string }> };
type Stat = { n: number; gc: number };

const isActive = (s: string) => /aktif/i.test(s);
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const AGENT_STATUS: [string, string][] = [["", "Semua status"], ["aktif", "Aktif"], ["resign", "Resign"], ["pindahan", "Pindahan"]];
const OFFICE_STATUS: [string, string][] = [["aktif", "Status: Aktif"], ["tutup", "Status: Tutup"], ["all", "Semua status"]];
const btnSm = "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[12.5px] font-semibold text-[var(--ink)] no-underline hover:bg-[var(--bg)]";

function addStat(m: Map<string, Stat>, key: string | null, l: LineRow) {
  if (!key) return;
  const s = m.get(key) ?? { n: 0, gc: 0 };
  m.set(key, { n: s.n + 1, gc: s.gc + (Number(l.komisi_gross) || 0) });
}

export default async function MasterPage({ searchParams }: Props) {
  const sp = await searchParams;
  const isAgen = sp.tab === "agen";
  const needle = norm(sp.q);
  const db = supabaseClosingAdmin();
  // Statistik transaksi/GC agen & kantor: tahun default (terakhir yang sudah mulai).
  const { year } = await loadYear();
  const [officesRes, agentsRes, asgRes, contacts, lines] = await Promise.all([
    db.from("offices").select("id,office_code,induk_name,cabang_name,kategori,status,report_channel,alamat").order("cabang_name").limit(1000),
    db.from("agents").select("id,employee_code,name,full_name,sheet_name,aliases,role,status").order("name").limit(5000),
    db.from("agent_assignments").select("agent_id,office_id,start_date,end_date,alasan").order("start_date").limit(10000),
    loadContacts(),
    fetchActiveLines(year),
  ]);
  for (const r of [officesRes, agentsRes, asgRes]) if (r.error) throw new Error(`Gagal baca master: ${r.error.message}`);
  const offices = (officesRes.data ?? []) as OfficeRow[];
  const agents = (agentsRes.data ?? []) as AgentRow[];
  const officeById = new Map(offices.map((o) => [o.id, o]));
  const officeName = (id: string) => officeById.get(id)?.cabang_name ?? "?";

  const history = new Map<string, Assignment[]>();
  for (const a of (asgRes.data ?? []) as Assignment[]) history.set(a.agent_id, [...(history.get(a.agent_id) ?? []), a]);
  const currentOf = (agentId: string) => history.get(agentId)?.at(-1)?.office_id ?? null;
  const moved = (agentId: string) => (history.get(agentId)?.length ?? 0) > 1;
  const everAt = (officeId: string) => agents.filter((a) => history.get(a.id)?.some((h) => h.office_id === officeId)).length;
  const activeAt = (officeId: string) => agents.filter((a) => isActive(a.status) && currentOf(a.id) === officeId);

  const byAgent = new Map<string, Stat>(), byOffice = new Map<string, Stat>();
  for (const l of lines) { addStat(byAgent, l.agent_id, l); addStat(byOffice, l.cabang_id, l); }

  // URL tanpa ?open (untuk tutup panel) dan dengan ?open=<id> (untuk buka panel), filter lain tetap.
  const keep = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k !== "open" && v));
  const closeHref = `/master?${new URLSearchParams(keep)}`;
  const openHref = (id: string, tab?: "agen" | "kantor") => `/master?${new URLSearchParams({ ...keep, ...(tab ? { tab } : {}), open: id })}`;

  const openOffice = sp.open ? officeById.get(sp.open) : undefined;
  const openAgent = sp.open ? agents.find((a) => a.id === sp.open) : undefined;
  // Tombol Hapus / Tandai Tutup / Resign di panel: transaksi semua tahun (statistik di atas hanya tahun {year}).
  const allYears = openOffice || openAgent
    ? await db.from("commission_lines").select("id", { count: "exact", head: true }).eq(openOffice ? "cabang_id" : "agent_id", (openOffice ?? openAgent)!.id).is("batal_at", null)
    : null;
  if (allYears?.error) throw new Error(`Gagal hitung transaksi: ${allYears.error.message}`);
  const totalLines = allYears?.count ?? 0;

  const ost = sp.st ?? "aktif";
  const oView = offices.filter((o) => (ost === "all" || (ost === "tutup" ? !isActive(o.status) : isActive(o.status)))
    && (!needle || [o.office_code, o.induk_name, o.cabang_name, ...(contacts.get(o.id) ?? []).map((c) => c.nama)].some((x) => norm(x).includes(needle))));
  const aView = agents.filter((a) => (!sp.role || a.role === sp.role)
    && (!sp.ast || (sp.ast === "pindahan" ? moved(a.id) : a.status === sp.ast))
    && (!sp.cab || history.get(a.id)?.some((h) => h.office_id === sp.cab))
    && (!needle || [a.employee_code, a.name, a.full_name, a.sheet_name, ...(a.aliases ?? [])].some((x) => norm(x).includes(needle))));
  const activeOffices = offices.filter((o) => isActive(o.status));

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <PageHeader eyebrow="Pengaturan" title="Master Kantor & Agen" desc="Kelola kantor (kategori tarif, kanal lapor, kontak admin) dan agen (role, status, pindah kantor). Agen dan kantor baru tidak pernah dibuat otomatis. Semua perubahan tercatat di log."
        actions={<><OfficeForm label="+ Kantor" triggerClass={btnPriCls} /><AgentForm label="+ Agen" offices={activeOffices} triggerClass={btnPriCls} /><Link href="/transfer" className={btnCls}>Pindah kantor agen</Link></>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Kantor aktif" value={activeOffices.length} sub={`${offices.length} total`} />
        <Kpi label="Kategori 3,5%" value={activeOffices.filter((o) => o.kategori === "3.5").length} sub={`9%: ${activeOffices.filter((o) => o.kategori === "9").length}`} />
        <Kpi label="Agen aktif" value={fmt(agents.filter((a) => isActive(a.status)).length)} sub={`${fmt(agents.length)} total`} />
        <Kpi label="Franchise Owner aktif" value={agents.filter((a) => a.role === "franchise_owner" && isActive(a.status)).length} sub={`Pindahan: ${agents.filter((a) => moved(a.id)).length}`} />
      </div>
      <div className="no-print mb-3 flex flex-wrap items-center justify-between gap-3">
        <Seg items={[
          { href: "/master?tab=kantor", on: !isAgen, label: <>Kantor <span className="ml-1 text-[var(--muted)]">{offices.length}</span></> },
          { href: "/master?tab=agen", on: isAgen, label: <>Agen <span className="ml-1 text-[var(--muted)]">{agents.length}</span></> },
        ]} />
        <NavForm action="/master" className="flex flex-wrap gap-2">
          <input type="hidden" name="tab" value={isAgen ? "agen" : "kantor"} />
          <input name="q" defaultValue={sp.q ?? ""} placeholder={isAgen ? "Cari nama / Agent ID…" : "Cari kantor / Office ID / nama admin…"} aria-label="Cari" className={`${selectCls} min-w-[220px]`} />
          {isAgen ? (
            <>
              <AutoSubmitSelect name="role" defaultValue={sp.role ?? ""} className={selectCls} aria-label="Role"><option value="">Semua role</option><option value="agent_property">Agent Property</option><option value="franchise_owner">Franchise Owner</option></AutoSubmitSelect>
              <AutoSubmitSelect name="ast" defaultValue={sp.ast ?? ""} className={selectCls} aria-label="Status agen">{AGENT_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</AutoSubmitSelect>
              <AutoSubmitSelect name="cab" defaultValue={sp.cab ?? ""} className={selectCls} aria-label="Kantor"><option value="">Semua kantor</option>{offices.map((o) => <option key={o.id} value={o.id}>{o.cabang_name}</option>)}</AutoSubmitSelect>
            </>
          ) : (
            <AutoSubmitSelect name="st" defaultValue={ost} className={selectCls} aria-label="Status kantor">{OFFICE_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</AutoSubmitSelect>
          )}
          <NavSubmit className={btnPriCls}>Cari</NavSubmit>
        </NavForm>
      </div>
      {isAgen ? (
        <div className="no-print mb-3 flex flex-wrap gap-1.5 text-[12px]">
          <span className="rounded-lg border border-[var(--line)] bg-white px-2 py-0.5">Agent Property: <b>{agents.filter((a) => a.role === "agent_property" && isActive(a.status)).length}</b> aktif</span>
          <span className="rounded-lg border border-[var(--line)] bg-white px-2 py-0.5">Franchise Owner: <b>{agents.filter((a) => a.role === "franchise_owner" && isActive(a.status)).length}</b> aktif</span>
          <span className="rounded-lg border border-[var(--line)] bg-white px-2 py-0.5">Ditampilkan: <b>{aView.length}</b></span>
        </div>
      ) : null}
      <Card>
        <div className="tw tall">
          {isAgen ? (
            <table className="t">
              <thead><tr><th>Agent ID</th><th>Nama</th><th>Role</th><th>Kantor saat ini</th><th>Status</th><th className="num">Transaksi {year}</th><th className="num">GC {year}</th><th /></tr></thead>
              <tbody>
                {aView.map((a) => {
                  const h = history.get(a.id) ?? [];
                  const cur = h.at(-1), prev = h.at(-2);
                  const s = byAgent.get(a.id);
                  return (
                    <tr key={a.id}>
                      <td className="font-mono text-[12.5px]">{a.employee_code}</td>
                      <td><Link href={openHref(a.id)} scroll={false} className="font-semibold text-[var(--ink)] no-underline hover:underline">{a.full_name || a.name}</Link>{a.full_name && a.full_name !== a.name ? <div className="text-[11.5px] text-[var(--muted)]">{a.name}</div> : null}</td>
                      <td>{roleBadge(a.role)}</td>
                      <td>{cur ? <b>{officeName(cur.office_id)}</b> : "—"}{prev && cur ? <div className="text-[11.5px] text-[var(--blue)]">⇄ pindahan dari {officeName(prev.office_id)} · sejak {fmtDate(cur.start_date)}</div> : null}</td>
                      <td>{statusBadge(a.status)}</td>
                      <td className="num">{s?.n ?? 0}</td>
                      <td className="num">{fmt(s?.gc ?? 0)}</td>
                      <td className="whitespace-nowrap text-right"><span className="inline-flex gap-1.5"><AgentForm agent={a} offices={[]} label="Edit" />{isActive(a.status) ? <Link href={`/transfer?agent=${a.id}`} className={btnSm}>Pindah kantor</Link> : null}</span></td>
                    </tr>
                  );
                })}
                {!aView.length && <tr><td colSpan={8} className="p-10 text-center text-[var(--muted)]">Tidak ada agen.</td></tr>}
              </tbody>
            </table>
          ) : (
            <table className="t">
              <thead><tr><th>Office ID</th><th>Kantor</th><th>Kategori</th><th>Kanal</th><th>Admin</th><th className="num">Agen aktif</th><th className="num">Transaksi {year}</th><th>Status</th><th /></tr></thead>
              <tbody>
                {oView.map((o) => {
                  const admin = pickPrimary(contacts.get(o.id) ?? []);
                  return (
                    <tr key={o.id}>
                      <td className="font-mono text-[12.5px]">{o.office_code || "—"}</td>
                      <td><Link href={openHref(o.id)} scroll={false} className="font-semibold text-[var(--ink)] no-underline hover:underline">{o.cabang_name}</Link><div className="text-[11.5px] text-[var(--muted)]">{o.induk_name}</div></td>
                      <td><Badge tone={o.kategori === "9" ? "blue" : "gray"}>{katLabel(o.kategori)} + PPN</Badge></td>
                      <td>{o.report_channel === "EXCEL" ? <Badge tone="green">Excel</Badge> : <Badge tone="blue">Genius</Badge>}</td>
                      <td className="min-w-[200px]">{admin ? <ContactLinks contact={admin} /> : <Badge tone="amber">Belum ada</Badge>}</td>
                      <td className="num">{activeAt(o.id).length}</td>
                      <td className="num">{fmt(byOffice.get(o.id)?.n ?? 0)}</td>
                      <td>{statusBadge(o.status)}</td>
                      <td className="whitespace-nowrap text-right"><span className="inline-flex gap-1.5"><Link href={openHref(o.id)} scroll={false} className={btnSm}>Detail</Link><OfficeForm office={{ ...o, report_channel: o.report_channel ?? "GENIUS" }} label="Edit" /></span></td>
                    </tr>
                  );
                })}
                {!oView.length && <tr><td colSpan={9} className="p-10 text-center text-[var(--muted)]">Tidak ada kantor.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      {openOffice ? (
        <OfficeDrawer o={openOffice} closeHref={closeHref} contacts={contacts.get(openOffice.id) ?? []} activeAgents={activeAt(openOffice.id)}
          year={year} totalLines={totalLines} lines={lines.filter((l) => l.cabang_id === openOffice.id)} agentsEver={everAt(openOffice.id)} agentHref={(id) => openHref(id, "agen")} />
      ) : null}
      {openAgent ? (
        <AgentDrawer a={openAgent} closeHref={closeHref} history={history.get(openAgent.id) ?? []} officeName={officeName} year={year} totalLines={totalLines}
          lines={lines.filter((l) => l.agent_id === openAgent.id)} officeHref={(id) => openHref(id, "kantor")} />
      ) : null}
    </main>
  );
}
