import Link from "next/link";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { fetchActiveLines, kategoriOf, type LineRow } from "@/lib/supabase/fetch-lines";
import { loadYear, monthsOfYear, periodValue } from "@/lib/closing/period-data";
import { ReconForm } from "@/components/admin-forms";
import { ContactLinks } from "@/components/contact-forms";
import { FinanceLink } from "@/components/finance-link";
import { PrintButton } from "@/components/print-button";
import { BULAN, Badge, Card, Kpi, PageHeader, Seg, btnPriCls, compact, fmt, katLabel, selectCls } from "@/components/ui";
import { NavForm, NavSubmit } from "@/components/pending";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { loadContacts, pickPrimary, type Contact } from "@/lib/closing/contacts";
import { isFinanceView } from "@/lib/supabase/auth-server";
import { botStatusByOffice, loadBotActivity, loadHeldClosings, type OfficeBotStatus } from "@/lib/bot/data";

// Rekonsiliasi Finance (v8, setara "List Data Office REPORT Closing"): SSDF & Royalti per kantor per bulan, sebelum PPN.
// Baris yang diinput dari Genius dibandingkan dengan officeFees.realValue Genius (PLAN §5), toleransi ±Rp2.
export const dynamic = "force-dynamic";

const TOLERANCE = 2;
const TONE: Record<string, "green" | "amber" | "gray" | "red"> = { Done: "green", Selisih: "amber", "Belum kirim": "red", Nihil: "gray" };
type OfficeRow = { id: string; cabang_name: string; induk_name: string; kategori: string; status: string; report_channel: string | null };
const sum = (rows: LineRow[], k: keyof LineRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);

// Hanya baris yang punya angka Genius (input lewat sistem); baris impor historis tidak punya pembanding.
function geniusCheck(L: LineRow[]) {
  const g = L.filter((r) => r.genius_ssdf !== null || r.genius_royalti !== null);
  if (!g.length) return null;
  const ssdf = sum(g, "genius_ssdf"), royalti = sum(g, "genius_royalti");
  return { ssdf, royalti, dSsdf: sum(g, "ssdf") - ssdf, dRoy: sum(g, "royalti") - royalti, partial: g.length < L.length };
}

function GeniusCell({ L }: { L: LineRow[] }) {
  const g = geniusCheck(L);
  if (!g) return <span className="text-[var(--muted)]">—</span>;
  const match = Math.abs(g.dSsdf) <= TOLERANCE && Math.abs(g.dRoy) <= TOLERANCE;
  return (
    <div className="text-right">
      <div className="tabular-nums">{fmt(g.ssdf)} / {fmt(g.royalti)}</div>
      {match ? <Badge tone="green">Cocok</Badge> : <Badge tone="amber">Selisih {fmt(g.dSsdf)} / {fmt(g.dRoy)}</Badge>}
      {g.partial ? <div className="text-[11px] text-[var(--muted)]">sebagian baris</div> : null}
    </div>
  );
}

// Status WA bot per kantor (bukan untuk tampilan finance): reminder terakhir + balasan terakhir.
const BOT_TONE: Record<string, "green" | "amber" | "gray" | "red" | "blue"> = { saved: "green", partial: "amber", held: "amber", rejected: "red", noted: "blue", processing: "gray" };
const BOT_STATUS: Record<string, string> = { saved: "Tersimpan", partial: "Sebagian", held: "Ditahan", rejected: "Ditolak", noted: "Dicatat", processing: "Diproses" };
const shortWib = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const MSG_MAX = 48;
const clip = (t: string) => (t.length > MSG_MAX ? `${t.slice(0, MSG_MAX)}…` : t);

function BotLine({ s }: { s: OfficeBotStatus }) {
  const r = s.lastReply;
  return (
    <div className="no-print mt-1 text-[11.5px] font-normal text-[var(--muted)]">
      {s.lastReminder ? <div>WA reminder {shortWib(s.lastReminder.sent_at)}{s.reminderCount > 1 ? ` (${s.reminderCount}×)` : ""}</div> : null}
      {r ? (
        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          <span>Dibalas {shortWib(r.replied_at ?? r.created_at)} ·</span>
          {r.kind === "excel_uploaded"
            ? <Badge tone="amber">Bilang sudah upload ke Drive — perlu diunggah HQ</Badge>
            : <span title={r.result?.message}><Badge tone={BOT_TONE[r.status] ?? "gray"}>{clip(r.result?.message || BOT_STATUS[r.status] || r.status)}</Badge></span>}
        </div>
      ) : null}
    </div>
  );
}

type Held = Awaited<ReturnType<typeof loadHeldClosings>>[number];

// Closing dari balasan WA yang ditahan karena agen/kantor belum ada di master.
function HeldLines({ items, period }: { items: Held[]; period: string }) {
  return (
    <div className="no-print mt-1 flex flex-col gap-1 text-[11.5px] font-normal">
      {items.map((h) => (
        <div key={h.closing_code}>
          <span className="font-mono text-[12px] text-[var(--ink)]">{h.closing_code}</span>{" "}
          <Link href={`/input?codes=${encodeURIComponent(h.closing_code)}&period=${period}`} className="font-semibold">Proses di Input</Link>
          <div className="text-[var(--amber)]">{h.reason}</div>
        </div>
      ))}
    </div>
  );
}

type Props = { searchParams: Promise<{ bulan?: string; tahun?: string; show?: string }> };
type Entry = { cabang_id: string; closings: { closing_code: string } | null; invoices: { invoice_number: string } | null };

// Isi kolom "Closing ID – Invoice ID": dari baris sistem; upload Excel → nama file; impor lama → List Data Office.
function idsOf(L: LineRow[], imported: string[]): string[] {
  const pairs = [...new Set(L.filter((r) => r.closing_code).map((r) => `${r.closing_code} - ${r.invoice_number ?? ""}`))];
  if (pairs.length) return pairs;
  const files = [...new Set(L.flatMap((r) => (r.upload_file ? [r.upload_file] : [])))];
  return files.length ? files : imported;
}

const KAT_ROWS: [string, keyof LineRow][] = [["Komisi Gross", "komisi_gross"], ["Royalti", "royalti"], ["SSDF", "ssdf"], ["Ke RMI", "ke_rmi"]];

export default async function RekonPage({ searchParams }: Props) {
  const { bulan, tahun, show } = await searchParams;
  const finance = await isFinanceView();
  const { periods, years, year } = await loadYear(tahun);
  const [lines, officesRes, contacts] = await Promise.all([
    fetchActiveLines(year),
    supabaseClosingAdmin().from("offices").select("id,cabang_name,induk_name,kategori,status,report_channel").order("cabang_name"),
    finance ? Promise.resolve(new Map<string, Contact[]>()) : loadContacts(),
  ]);
  if (officesRes.error) throw new Error(`Gagal baca kantor: ${officesRes.error.message}`);
  const offices = (officesRes.data ?? []) as OfficeRow[];
  const withData = lines.map((r) => r.periods?.month).filter((m): m is number => !!m);
  const months = monthsOfYear(periods, lines, year);
  const month = months.includes(Number(bulan)) ? Number(bulan) : Math.max(0, ...withData) || months[months.length - 1] || 1;
  const inMonth = lines.filter((r) => r.periods?.month === month);
  const db = supabaseClosingAdmin();
  const periodId = periods.find((p) => p.year === year && p.month === month)?.id ?? null;
  const [{ data: rs, error: rsErr }, { data: es, error: esErr }] = periodId
    ? await Promise.all([
      db.from("recon_status").select("cabang_id,status,catatan").eq("period_id", periodId),
      db.from("report_entries").select("cabang_id,closings!closing_id(closing_code),invoices!invoice_id(invoice_number)").eq("period_id", periodId).limit(5000),
    ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (rsErr) throw new Error(`Gagal baca status rekon: ${rsErr.message}`);
  if (esErr) throw new Error(`Gagal baca daftar ID impor: ${esErr.message}`);
  const [botStatus, heldList] = periodId && !finance
    ? await Promise.all([loadBotActivity(periodId).then(botStatusByOffice), loadHeldClosings(periodId)])
    : [new Map<string, OfficeBotStatus>(), [] as Held[]];
  const held = new Map<string, Held[]>();
  for (const h of heldList) held.set(h.cabang_id, [...(held.get(h.cabang_id) ?? []), h]);
  const pv = periods.find((p) => p.id === periodId);
  const periodQ = pv ? periodValue(pv) : "";
  const imported = new Map<string, string[]>();
  for (const e of (es ?? []) as unknown as Entry[]) {
    const pair = `${e.closings?.closing_code ?? "—"} - ${e.invoices?.invoice_number ?? ""}`;
    imported.set(e.cabang_id, [...new Set([...(imported.get(e.cabang_id) ?? []), pair])]);
  }
  const recon = new Map((rs ?? []).map((x) => [x.cabang_id as string, x as { status: string; catatan: string | null }]));
  const by = new Map<string, LineRow[]>();
  for (const r of inMonth) { const c = r.offices?.cabang_name ?? "?"; by.set(c, [...(by.get(c) ?? []), r]); }
  const all = offices.filter((o) => /aktif/i.test(o.status) || by.has(o.cabang_name)).map((o) => ({ o, L: by.get(o.cabang_name) ?? [] }));
  const rows = show === "all" ? all : all.filter((x) => x.L.length);
  const lapor = all.filter((x) => x.L.length);
  const tot = (k: keyof LineRow) => lapor.reduce((a, x) => a + sum(x.L, k), 0);

  return (
    <main className="mx-auto max-w-6xl p-6">
      <PageHeader
        eyebrow={`Rekonsiliasi · ${BULAN[month - 1]} ${year}`}
        title="Rekonsiliasi Finance"
        desc="Setara “List Data Office REPORT Closing”. SSDF & Royalti dihitung dari baris closing (sebelum PPN); closing yang diinput dari Genius dibandingkan dengan angka Genius."
        actions={
          <>
            <NavForm action="/rekon" className="flex gap-2">
              {show === "all" ? <input type="hidden" name="show" value="all" /> : null}
              <AutoSubmitSelect name="tahun" defaultValue={String(year)} className={selectCls} aria-label="Tahun">
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </AutoSubmitSelect>
              <select name="bulan" defaultValue={String(month)} className={selectCls} aria-label="Bulan">
                {months.map((m) => <option key={m} value={m}>{BULAN[m - 1]} {year}</option>)}
              </select>
              <NavSubmit className={btnPriCls}>Terapkan</NavSubmit>
            </NavForm>
            <PrintButton />
          </>
        }
      />
      {finance ? null : <FinanceLink />}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Kantor lapor" value={lapor.length} sub={`dari ${all.length} kantor aktif`} />
        <Kpi label="Total SSDF" value={compact(tot("ssdf"))} sub="sebelum PPN" />
        <Kpi label="Total Royalty" value={compact(tot("royalti"))} sub="sebelum PPN" />
        <Kpi label="Status cek" value={`${lapor.filter((x) => recon.get(x.o.id)?.status === "Done").length}/${lapor.length}`} sub="kantor lapor berstatus Done" />
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        {(["3.5", "9"] as const).map((k) => {
          const L = inMonth.filter((r) => kategoriOf(r) === k);
          return (
            <Card key={k} className="p-5">
              <div className="flex justify-between"><h3 className="font-display text-[15px] font-bold">Kategori {katLabel(k)} + PPN</h3><span className="text-[var(--muted)]">{fmt(L.length)} baris</span></div>
              <table className="t mt-2"><tbody>{KAT_ROWS.map(([l, key]) => <tr key={key}><td>{l}</td><td className="num font-bold">Rp{fmt(sum(L, key))}</td></tr>)}</tbody></table>
            </Card>
          );
        })}
      </div>
      <div className="mb-3">
        <Seg items={[
          { href: `/rekon?tahun=${year}&bulan=${month}`, on: show !== "all", label: "Kantor lapor" },
          { href: `/rekon?tahun=${year}&bulan=${month}&show=all`, on: show === "all", label: "Semua kantor" },
        ]} />
      </div>
      <Card>
        <div className="tw tall">
          <table className="t">
            <thead><tr><th>No</th><th>Nama Office</th><th>Report In</th><th>Closing ID – Invoice ID</th><th className="num">Baris</th><th className="num">GC</th><th className="num">SSDF</th><th className="num">Royalty</th><th className="num">%</th><th className="num">Ke RMI</th><th className="num">Genius SSDF / Royalty</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(({ o, L }, i) => {
                const st = recon.get(o.id);
                const badge = st ? <Badge tone={TONE[st.status] ?? "gray"}>{st.status}</Badge> : L.length ? <Badge tone="amber">Belum dicek</Badge> : <Badge tone="red">Belum lapor</Badge>;
                const contact = pickPrimary(contacts.get(o.id) ?? []);
                const bs = botStatus.get(o.id);
                return (
                  <tr key={o.cabang_name}>
                    <td className="text-[var(--muted)]">{i + 1}</td>
                    <td className="font-semibold">
                      {o.cabang_name}<div className="text-[11.5px] font-normal text-[var(--muted)]">{o.induk_name}</div>
                      {contact ? <div className="no-print mt-1 font-normal"><ContactLinks contact={contact} /></div> : null}
                      {bs ? <BotLine s={bs} /> : null}
                      {held.get(o.id)?.length ? <HeldLines items={held.get(o.id)!} period={periodQ} /> : null}
                    </td>
                    <td>{L.length ? (o.report_channel === "EXCEL" ? <Badge tone="green">Excel</Badge> : <Badge tone="blue">Genius</Badge>) : <Badge>—</Badge>}</td>
                    <td className="whitespace-nowrap font-mono text-[12px]">{idsOf(L, imported.get(o.id) ?? []).map((x, j) => <div key={x}>{j + 1}. {x}</div>)}</td>
                    <td className="num">{L.length || ""}</td>
                    <td className="num">{L.length ? fmt(sum(L, "komisi_gross")) : ""}</td>
                    <td className="num">{L.length ? fmt(sum(L, "ssdf")) : ""}</td>
                    <td className="num">{L.length ? fmt(sum(L, "royalti")) : ""}</td>
                    <td className="num">{o.kategori === "9" ? "9%" : "3,5%"}</td>
                    <td className="num font-bold">{L.length ? fmt(sum(L, "ke_rmi")) : ""}</td>
                    <td>{L.length ? <GeniusCell L={L} /> : null}</td>
                    <td>
                      {periodId && !finance ? <ReconForm periodId={periodId} cabangId={o.id} cabang={o.cabang_name} status={st?.status ?? ""} catatan={st?.catatan ?? ""} badge={badge} /> : badge}
                      {st?.catatan ? <div className="mt-1 text-[11.5px] text-[var(--muted)]">{st.catatan}</div> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot><tr><td /><td colSpan={3}>Total {lapor.length} kantor lapor</td><td className="num">{fmt(inMonth.length)}</td><td className="num">{fmt(tot("komisi_gross"))}</td><td className="num">{fmt(tot("ssdf"))}</td><td className="num">{fmt(tot("royalti"))}</td><td /><td className="num">{fmt(tot("ke_rmi"))}</td><td /><td /></tr></tfoot>
          </table>
        </div>
      </Card>
    </main>
  );
}
