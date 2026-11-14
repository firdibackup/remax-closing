import Link from "next/link";
import { fetchActiveLines, type LineRow } from "@/lib/supabase/fetch-lines";
import { loadActiveOffices, loadPeriods, nihilOfficeIds, periodValue, pickPeriod, reportState, type ReportState } from "@/lib/closing/period-data";
import { countdown, cutoffOf, periodState } from "@/lib/closing/periods";
import { loadContacts, pickPrimary } from "@/lib/closing/contacts";
import { waLink } from "@/lib/closing/phone";
import { CancelRemindButton, NihilButton, RemindButton } from "@/components/admin-forms";
import { AutoSubmitSelect } from "@/components/auto-submit-select";
import { BULAN, Badge, Card, Kpi, PageHeader, PeriodBadge, btnCls, btnPriCls, compact, fmt, fmtWib, katLabel, periodLabel, selectCls } from "@/components/ui";
import { NavForm } from "@/components/pending";
import { loadBotSettings, loadHeldClosings, loadOfficeWaFlags } from "@/lib/bot/data";
import { MAX_ATTEMPTS, isCekDrive, skipLabel } from "@/lib/bot/schedule";

// Beranda (mockup v8): periode kerja, status cut-off, progres kantor lapor, grafik GC, dan daftar kantor periode ini.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ bulan?: string }> };
// cek_drive = admin Excel bilang via WA file sudah di Google Drive; HQ unduh lalu impor lewat Upload.
type CardState = ReportState | "cek_drive";
const STATE_ORDER: Record<CardState, number> = { belum: 0, cek_drive: 1, lapor: 2, nihil: 3 };
const STATE_BADGE: Record<CardState, [tone: "red" | "amber" | "green" | "gray", text: string, long: string]> = {
  belum: ["red", "Belum", "Belum lapor"], cek_drive: ["amber", "Cek Drive", "Cek Drive"], lapor: ["green", "Lapor", "Sudah lapor"], nihil: ["gray", "Nihil", "Nihil"],
};
const fmtSent = (iso: string) => new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });
const sum = (rows: LineRow[], k: keyof LineRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
const miniBtn = "rounded-md border border-[var(--line)] bg-white px-2 py-0.5 text-[11.5px] font-semibold text-[var(--ink)] no-underline hover:bg-[var(--bg)]";

export default async function HomePage({ searchParams }: Props) {
  const { bulan } = await searchParams;
  const [periods, rows, offices, contacts] = await Promise.all([loadPeriods(), fetchActiveLines(), loadActiveOffices(), loadContacts()]);
  const p = pickPeriod(periods, bulan);
  if (!p) {
    return <main className="mx-auto max-w-[1400px] p-6"><PageHeader eyebrow="Beranda" title="Belum ada periode" desc="Buat periode dulu di Periode & Cut-off." /></main>;
  }
  const [nihil, held, waFlags, bot] = await Promise.all([nihilOfficeIds(p.id), loadHeldClosings(p.id), loadOfficeWaFlags(p.id), loadBotSettings()]);
  const state = periodState(p);
  const label = periodLabel(p);
  const cur = rows.filter((r) => r.periods?.id === p.id);
  const reported = new Set(cur.map((r) => r.cabang_id));
  const list = offices
    .map((o) => {
      const f = waFlags.get(o.id);
      const base = reportState(o.id, reported, nihil);
      const s: CardState = base === "belum" && o.report_channel === "EXCEL" && isCekDrive(f?.uploadedAt, f?.driveMissingAt, reported.has(o.id)) ? "cek_drive" : base;
      return { o, s, f };
    })
    .sort((a, b) => STATE_ORDER[a.s] - STATE_ORDER[b.s] || a.o.cabang_name.localeCompare(b.o.cabang_name));
  const done = list.filter((x) => x.s === "lapor" || x.s === "nihil").length;
  const pct = offices.length ? Math.round((done / offices.length) * 100) : 0;
  const byMonth = Array(12).fill(0) as number[];
  for (const r of rows) if (r.periods?.year === p.year) byMonth[r.periods.month - 1] += Number(r.komisi_gross) || 0;
  const max = Math.max(1, ...byMonth);
  const cd = countdown(p);
  const nSrc = (s: string) => cur.filter((r) => r.source === s).length;

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        eyebrow={<span className="inline-flex items-center gap-2">Periode {label} <PeriodBadge state={state} /></span>}
        title={`Closing ${label}`}
        desc="Ringkasan periode kerja. Mulai dari daftar kantor di bawah: kantor Genius → tempel Closing ID, kantor Excel → upload template."
        actions={
          <NavForm action="/">
            <AutoSubmitSelect name="bulan" defaultValue={String(p.month)} className={selectCls} aria-label="Periode">
              {periods.map((x) => <option key={x.id} value={x.month}>{periodLabel(x)} · {{ open: "terbuka", locked: "terkunci", future: "belum mulai" }[periodState(x)]}</option>)}
            </AutoSubmitSelect>
          </NavForm>
        }
      />
      {held.length ? (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] bg-[#FFF4DF] px-3.5 py-2.5 text-[13px] text-[#6B4000]">
          <b>{held.length} closing dari balasan WA ditahan: data agen/kantor belum ada di master.</b>
          <Link href={`/rekon?bulan=${p.month}`} className="font-semibold text-[#6B4000] underline">Lihat di Rekonsiliasi</Link>
        </div>
      ) : null}
      <div className="mb-4 grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card className="flex flex-col justify-between gap-5 p-5">
          <div>
            <div className="mb-2.5 text-[12.5px] font-semibold text-[var(--muted)]">STATUS CUT-OFF</div>
            {state === "open" && cd ? (
              <>
                <div className="font-display text-[40px] font-extrabold leading-none tracking-tight">{cd.days} hari {cd.hours} jam</div>
                <div className="mt-1.5 text-[var(--muted)]">menuju cut-off <b className="text-[var(--ink)]">{fmtWib(cutoffOf(p))} WIB</b>. Setelah itu periode otomatis terkunci.</div>
              </>
            ) : state === "future" ? (
              <div className="font-display text-[40px] font-extrabold leading-none tracking-tight text-[var(--muted)]">Belum mulai</div>
            ) : (
              <>
                <div className="font-display text-[40px] font-extrabold leading-none tracking-tight text-[var(--red)]">Terkunci</div>
                <div className="mt-1.5 text-[var(--muted)]">Buka kunci lewat <Link href="/periode">Periode &amp; Cut-off</Link> bila perlu koreksi.</div>
              </>
            )}
          </div>
          <div>
            <div className="mb-1.5 flex justify-between text-[13px]"><span><b>{done}</b> dari {offices.length} kantor aktif sudah lapor / nihil</span><span className="text-[var(--muted)]">{pct}%</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-[var(--line-2)]"><i className="block h-full rounded-full bg-[var(--blue)]" style={{ width: `${pct}%` }} /></div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href={`/input?period=${periodValue(p)}`} className={btnPriCls}>Input Closing Genius</Link>
            <Link href={`/upload?period=${p.id}`} className={btnCls}>Upload Excel kantor</Link>
            <Link href={`/rekon?bulan=${p.month}`} className={btnCls}>Kirim ke Finance</Link>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-bold">GC per bulan {p.year}</h2>
            <span className="text-xs text-[var(--muted)]">Total Komisi · klik bulan</span>
          </div>
          <svg viewBox="0 0 360 150" className="h-auto w-full" role="img" aria-label={`Grafik GC per bulan ${p.year}`}>
            {byMonth.map((v, i) => {
              const h = Math.max(2, (v / max) * 112);
              const on = i === p.month - 1;
              return (
                <a key={i} href={`/?bulan=${i + 1}`}>
                  <title>{`${BULAN[i]}: Rp${fmt(v)}`}</title>
                  <rect x={i * 30 + 4} y={120 - h} width={22} height={h} rx={4} fill={on ? "#DC1C2E" : v ? "#003DA5" : "#E4E7EC"} opacity={on ? 1 : 0.85} />
                  <text x={i * 30 + 15} y={140} fontSize={9.5} textAnchor="middle" fill={on ? "#DC1C2E" : "#6B7280"} fontWeight={on ? 700 : 500}>{BULAN[i].slice(0, 3)}</text>
                </a>
              );
            })}
          </svg>
        </Card>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Total GC (Komisi Gross)" value={compact(sum(cur, "komisi_gross"))} sub={`${fmt(cur.length)} baris agen`} />
        <Kpi label="Pembayaran ke RMI" value={compact(sum(cur, "ke_rmi"))} sub="Royalti + SSDF setelah pajak" />
        <Kpi label="SSDF / Royalti" value={compact(sum(cur, "ssdf"))} sub={`Royalti ${compact(sum(cur, "royalti"))}`} />
        <Kpi label="Sumber data" value={`${nSrc("genius")} · ${nSrc("excel")}`} sub={`baris Genius · baris Excel${nSrc("import") ? ` · ${fmt(nSrc("import"))} impor` : ""}`} />
      </div>
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-2)] px-5 py-4">
          <div>
            <h2 className="text-[18px] font-bold">Kantor periode ini</h2>
            <div className="text-[12.5px] text-[var(--muted)]">Klik kantor untuk input / upload. Tandai “Nihil” bila kantor tidak ada closing.</div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(["belum", "cek_drive", "lapor", "nihil"] as const).map((k) => {
              const n = list.filter((x) => x.s === k).length;
              return k === "cek_drive" && !n ? null : <Badge key={k} tone={STATE_BADGE[k][0]}>{STATE_BADGE[k][2]} · {n}</Badge>;
            })}
          </div>
        </div>
        <div className="grid gap-2 p-5 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {list.map(({ o, s, f }) => {
            const excel = o.report_channel === "EXCEL";
            const href = excel ? `/upload?period=${p.id}&office=${o.id}` : `/input?period=${periodValue(p)}`;
            const contact = pickPrimary(contacts.get(o.id) ?? []);
            const open = state === "open";
            const to = contact?.phone ? (contact.nama ? `${contact.nama} (${contact.phone})` : contact.phone) : "admin kantor";
            const canBot = open && bot.active && ((s === "belum" && !!contact?.phone) || s === "cek_drive");
            const pending = f?.pending;
            const botCtl = !canBot ? null : pending ? (
              <span className="flex items-center gap-0.5 text-[11px] text-[var(--muted)]" title={`Dicatat ${fmtSent(pending.created_at)} WIB`}>
                {pending.claimed_at ? "Bot sedang kirim" : "Menunggu bot"}
                {pending.claimed_at ? null : <CancelRemindButton id={pending.id} cabang={o.cabang_name} />}
              </span>
            ) : (
              <RemindButton periodId={p.id} cabangId={o.id} cabang={o.cabang_name} periodLabel={label} to={to} excel={excel} trigger={s === "cek_drive" ? "drive_missing" : "manual"} />
            );
            const hubungi = contact?.phone
              ? <a href={waLink(contact.phone)} target="_blank" rel="noopener noreferrer" title={`WA ${contact.nama ?? ""}`} className={miniBtn}>Hubungi</a>
              : null;
            return (
              <div key={o.id} className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--line)] bg-white px-3 py-2 text-[13px] hover:border-[var(--blue-200)]">
                <Link href={href} className="min-w-0 text-[var(--ink)] no-underline" title={s === "cek_drive" ? "Admin bilang file sudah di Google Drive. Unduh lalu impor lewat Upload." : undefined}>
                  <span className="block truncate font-medium">{o.cabang_name}</span>
                  <span className="block truncate text-[11.5px] text-[var(--muted)]">{excel ? "Excel" : "Genius"} · {katLabel(o.kategori)}</span>
                  {f?.lastFailedAt && f.lastFailedAt > (f.lastSentAt ?? "") && f.lastFailedAt > (f.lastSkip?.at ?? "") ? (
                    <span className="block truncate text-[11px] font-semibold text-[var(--red)]" title={`Bot sudah ${MAX_ATTEMPTS}x mengambil antrean kantor ini tanpa melapor terkirim. Cek WA bot, lalu klik Ingatkan lagi bila perlu.`}>
                      Bot gagal kirim {fmtSent(f.lastFailedAt)}
                    </span>
                  ) : f?.lastSkip && (!f.lastSentAt || f.lastSkip.at > f.lastSentAt) ? (
                    <span className="block truncate text-[11px] text-[var(--muted)]" title={`Bot mengecek ${fmtSent(f.lastSkip.at)} WIB dan tidak mengirim WA: ${skipLabel(f.lastSkip.reason)}`}>
                      Dicek bot {fmtSent(f.lastSkip.at)}: {skipLabel(f.lastSkip.reason)}
                    </span>
                  ) : f?.lastSentAt ? <span className="block truncate text-[11px] text-[var(--muted)]" title="Reminder WA terakhir">WA {fmtSent(f.lastSentAt)}</span> : null}
                </Link>
                <span className="flex flex-none flex-col items-end gap-1">
                  <Badge tone={STATE_BADGE[s][0]}>{STATE_BADGE[s][1]}</Badge>
                  {open && s === "belum" ? (
                    <span className="flex flex-wrap justify-end gap-1">
                      {hubungi ?? <Link href={`/master?open=${o.id}`} title="Belum ada nomor admin" className={miniBtn}>Kontak</Link>}
                      <NihilButton periodId={p.id} cabangId={o.id} cabang={o.cabang_name} periodLabel={label} />
                    </span>
                  ) : null}
                  {open && s === "cek_drive" ? (
                    <span className="flex flex-wrap items-center justify-end gap-1">{hubungi}{botCtl}</span>
                  ) : botCtl}
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </main>
  );
}
