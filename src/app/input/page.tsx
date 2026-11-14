import Link from "next/link";
import { PageHeader, Card, Badge, PeriodBadge, btnCls, btnPriCls, selectCls, fmt, katLabel, periodLabel } from "@/components/ui";
import { NavForm, SubmitButton } from "@/components/pending";
import { previewClosings, saveClosings } from "@/app/actions/input";
import { AgentForm, OfficeForm } from "@/components/admin-forms";
import { ContactLinks } from "@/components/contact-forms";
import { ClosingCodesInput } from "@/components/closing-codes-input";
import { CancelClosingButton } from "@/components/line-actions";
import { parseCodes } from "@/lib/closing/codes";
import { loadContacts, pickPrimary, type Contact } from "@/lib/closing/contacts";
import { defaultPeriod, isFuture, periodState } from "@/lib/closing/periods";
import { loadPeriods, periodValue, type PeriodRow } from "@/lib/closing/period-data";
import { freshLines, isReady, type ClosingPreview, type NewLine } from "@/lib/genius/pull";
import { supabaseClosingAdmin } from "@/lib/supabase/client";

// Input Closing Genius (PLAN §3.5a, §9 no. 3): tempel Closing ID → tarik dari Genius → pratinjau per kantor → simpan.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ codes?: string; period?: string; saved?: string; err?: string }> };
type OfficeOpt = { id: string; cabang_name: string };
type SavedLine = { id: string; closing_code: string; invoice_number: string | null; ma_name: string | null; lsl: string | null; komisi_gross: number; ssdf: number; royalti: number; offices: { cabang_name: string } | null };
type Group = { key: string; title: string; tone: "ink" | "red"; cabangId: string | null; kategori: string | null; items: ClosingPreview[] };

const linkBtn = "rounded-lg border border-red-300 bg-white px-2.5 py-1 text-[12.5px] font-semibold text-red-800 hover:bg-red-50";
const STEPS = ["Periode", "Tempel Closing ID", "Cek hitungan", "Simpan"];
const KATEGORI_9_MIN_ROYALTY = 0.0075;
const sumL = (ls: NewLine[], k: "komisi_gross" | "royalti" | "ssdf" | "ke_rmi") => ls.reduce((a, l) => a + l[k], 0);
const sumS = (ls: SavedLine[], k: "komisi_gross" | "royalti" | "ssdf") => ls.reduce((a, l) => a + (Number(l[k]) || 0), 0);

// Closing dikelompokkan per kantor (dari baris pertamanya); yang gagal ditarik / ditahan di kelompok sendiri.
function groupByOffice(previews: ClosingPreview[]): Group[] {
  const map = new Map<string, Group>();
  for (const p of previews) {
    const first = p.lines[0];
    const key = first ? first.cabang_id : p.error ? "~err" : "~hold";
    const g = map.get(key) ?? {
      key,
      title: first ? first.cabang_name : p.error ? "Tidak ditemukan di Genius" : "Perlu dilengkapi di master",
      tone: first ? "ink" : "red",
      cabangId: first?.cabang_id ?? null,
      kategori: first ? (first.royalty_rate >= KATEGORI_9_MIN_ROYALTY ? "9" : "3.5") : null,
      items: [],
    };
    map.set(key, { ...g, items: [...g.items, p] });
  }
  return [...map.values()].sort((a, b) => (a.tone === b.tone ? a.title.localeCompare(b.title) : a.tone === "ink" ? -1 : 1));
}

async function loadSaved(periodId: string): Promise<Map<string, SavedLine[]>> {
  const { data, error } = await supabaseClosingAdmin().from("commission_lines")
    .select("id,closing_code,invoice_number,ma_name,lsl,komisi_gross,ssdf,royalti,offices!cabang_id(cabang_name)")
    .eq("period_id", periodId).eq("source", "genius").is("batal_at", null).order("closing_code").limit(5000);
  if (error) throw new Error(`Gagal baca input tersimpan: ${error.message}`);
  const by = new Map<string, SavedLine[]>();
  for (const l of (data ?? []) as unknown as SavedLine[]) by.set(l.closing_code, [...(by.get(l.closing_code) ?? []), l]);
  return by;
}

export default async function InputPage({ searchParams }: Props) {
  const sp = await searchParams;
  const codes = parseCodes(sp.codes ?? "");
  const [periods, oRes] = await Promise.all([
    loadPeriods(),
    supabaseClosingAdmin().from("offices").select("id,cabang_name").eq("status", "aktif").order("cabang_name").limit(1000),
  ]);
  if (oRes.error) throw new Error(`Gagal baca kantor: ${oRes.error.message}`);
  const offices = (oRes.data ?? []) as OfficeOpt[];
  const started = periods.filter((p) => !isFuture(p));
  const period: PeriodRow | undefined = started.find((p) => periodValue(p) === sp.period) ?? defaultPeriod(periods);
  const writable = !!period && periodState(period) === "open";
  const previews = codes.length ? await previewClosings(codes) : [];
  const ready = previews.filter(isReady);
  const fresh = ready.flatMap(freshLines);
  const nInvoices = new Set(fresh.map((l) => l.invoice_number)).size;
  const holdCount = previews.reduce((s, p) => s + p.holds.length, 0);
  const groups = groupByOffice(previews);
  const [contacts, saved] = await Promise.all([
    loadContacts(groups.flatMap((g) => (g.cabangId ? [g.cabangId] : []))),
    period ? loadSaved(period.id) : Promise.resolve(new Map<string, SavedLine[]>()),
  ]);
  const step = !codes.length ? 2 : 3;
  const label = period ? periodLabel(period) : "—";

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <PageHeader eyebrow="Input · sumber Genius" title="Input Closing Genius" desc={<>Tempel daftar <b>Closing ID</b> dari kantor mana saja, boleh campur. Kantor, agen, dan Invoice ID dibaca otomatis dari Genius. Periksa hitungannya, lalu simpan.</>} />
      <div className="mb-4 flex flex-wrap items-center gap-1.5 text-[12.5px] text-[var(--muted)]">
        {STEPS.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5">
            <i className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold not-italic ${i + 1 < step ? "bg-[var(--green)] text-white" : i + 1 === step ? "bg-[var(--blue)] text-white" : "bg-[var(--line-2)] text-[var(--ink-2)]"}`}>{i + 1 < step ? "✓" : i + 1}</i>
            <span className={i + 1 === step ? "font-semibold text-[var(--ink)]" : ""}>{s}</span>
            {i < STEPS.length - 1 ? <span className="text-[#C9CED6]">—</span> : null}
          </span>
        ))}
      </div>

      {sp.saved !== undefined && <div role="status" className="mb-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{sp.saved} baris tersimpan ke {label}. Laporan, GC Office, dan Top MA ikut diperbarui. <Link href={`/laporan?bulan=${period?.month ?? ""}`}>Lihat laporan</Link></div>}
      {sp.err && <div role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{sp.err}</div>}

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className="p-5">
          <NavForm action="/input" className="grid gap-3.5">
            <label className="grid gap-1.5 text-[12.5px] font-semibold text-[var(--ink-2)]">
              Periode laporan
              <select name="period" defaultValue={period ? periodValue(period) : ""} className={`${selectCls} font-normal`}>
                {started.map((p) => <option key={p.id} value={periodValue(p)}>{periodLabel(p)} · {periodState(p) === "open" ? "terbuka" : "terkunci"}</option>)}
              </select>
              <span className="flex flex-wrap items-center gap-1.5 font-normal text-[var(--muted)]">Default: periode terbuka dengan cut-off terdekat. {period ? <PeriodBadge state={periodState(period)} /> : null}</span>
            </label>
            <div className="grid gap-1.5 text-[12.5px] font-semibold text-[var(--ink-2)]">
              Daftar Closing ID
              <ClosingCodesInput defaultValue={codes.join("\n")} />
            </div>
            <p className="rounded-lg bg-[var(--blue-50)] px-3 py-2 text-[12.5px] text-[var(--blue-ink)]">Invoice ID tiap closing diambil otomatis dari Genius. Invoice yang sudah pernah dilaporkan tidak dihitung lagi.</p>
          </NavForm>
        </Card>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
          {!previews.length ? (
            <Card className="px-5 py-12 text-center text-[var(--muted)]"><b className="mb-1 block font-display text-base text-[var(--ink)]">Belum ada pratinjau</b>Tempel daftar Closing ID lalu klik <b>Tarik dari Genius</b>.</Card>
          ) : (
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-2)] px-5 py-4">
                <div>
                  <h2 className="text-[18px] font-bold">Pratinjau hasil tarik</h2>
                  <div className="text-[12.5px] text-[var(--muted)]">
                    {previews.length} closing · {groups.filter((g) => g.cabangId).length} kantor · <b className="text-[var(--ink)]">{nInvoices} invoice baru</b> · {fresh.length} baris agen
                    {previews.some((p) => p.error) ? <span className="text-[var(--red)]"> · {previews.filter((p) => p.error).length} tidak ditemukan</span> : null}
                    {holdCount ? <span className="text-[var(--red)]"> · {holdCount} ditahan</span> : null}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link href={`/input?period=${period ? periodValue(period) : ""}`} className={btnCls}>Batal</Link>
                  {ready.length && writable && period ? (
                    <form action={saveClosings}>
                      <input type="hidden" name="codes" value={codes.join("\n")} />
                      <input type="hidden" name="period" value={periodValue(period)} />
                      <SubmitButton pendingText="Menyimpan…" className={btnPriCls}>Simpan {nInvoices} invoice ke {label}</SubmitButton>
                    </form>
                  ) : <button disabled className={`${btnPriCls} opacity-50`}>Simpan</button>}
                </div>
              </div>
              {!writable ? <div className="mx-5 mt-4 rounded-lg bg-[var(--red-50)] px-3 py-2 text-[13px] text-[#8A0F1B]">Periode {label} terkunci. Pilih periode terbuka atau buka kunci di <Link href="/periode">Periode &amp; Cut-off</Link>.</div> : null}
              <div className="px-5 py-4">
                <h3 className="mb-1 font-display text-[15px] font-bold">1. Closing &amp; invoice per kantor</h3>
                <p className="mb-3 text-[12.5px] text-[var(--muted)]">Dikelompokkan otomatis dari kantor agen pada tanggal closing.</p>
                {groups.map((g) => <OfficeGroup key={g.key} g={g} contacts={contacts} offices={offices} />)}
              </div>
              <div className="border-t border-[var(--line-2)] px-5 py-4">
                <h3 className="mb-2.5 font-display text-[15px] font-bold">2. Hitungan baris baru</h3>
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {([["Komisi Gross (A)", "komisi_gross"], ["Royalti (B)", "royalti"], ["SSDF (F)", "ssdf"], ["Ke RMI (J)", "ke_rmi"]] as const).map(([l, k]) => (
                    <div key={k} className="rounded-[10px] bg-[var(--bg)] px-3 py-2.5"><div className="text-[12px] text-[var(--muted)]">{l}</div><b className="font-display text-[18px] font-extrabold tabular-nums">Rp{fmt(sumL(fresh, k))}</b></div>
                  ))}
                </div>
                <p className="mt-2 text-[12px] text-[var(--muted)]">Closing yang ditahan dan invoice yang sudah dilaporkan tidak ikut disimpan.</p>
              </div>
            </Card>
          )}

          <Card>
            <div className="flex items-center justify-between border-b border-[var(--line-2)] px-5 py-4">
              <h3 className="font-display text-[15px] font-bold">Sudah tersimpan · {label}</h3>
              <span className="text-[12.5px] text-[var(--muted)]">{saved.size} closing</span>
            </div>
            {saved.size ? (
              <div className="tw">
                <table className="t">
                  <thead><tr><th>Closing</th><th>Invoice</th><th>Kantor</th><th>MA</th><th className="num">Komisi</th><th className="num">SSDF</th><th className="num">Royalti</th><th /></tr></thead>
                  <tbody>
                    {[...saved.entries()].map(([code, ls]) => (
                      <tr key={code}>
                        <td className="font-mono text-[12.5px]">{code}</td>
                        <td className="font-mono text-[12px]">{[...new Set(ls.map((l) => l.invoice_number))].map((v) => <div key={v}>{v}</div>)}</td>
                        <td>{[...new Set(ls.map((l) => l.offices?.cabang_name))].join(", ")}</td>
                        <td>{[...new Set(ls.map((l) => `${l.ma_name ?? ""} (${l.lsl ?? ""})`))].map((m) => <div key={m}>{m}</div>)}</td>
                        <td className="num">{fmt(sumS(ls, "komisi_gross"))}</td>
                        <td className="num">{fmt(sumS(ls, "ssdf"))}</td>
                        <td className="num">{fmt(sumS(ls, "royalti"))}</td>
                        <td>{writable ? <CancelClosingButton lineId={ls[0].id} closingCode={code} periodLabel={label} /> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="px-5 py-6 text-center text-[var(--muted)]">Belum ada input Genius di periode ini.</div>}
          </Card>
        </div>
      </div>
    </main>
  );
}

function OfficeGroup({ g, contacts, offices }: { g: Group; contacts: Map<string, Contact[]>; offices: OfficeOpt[] }) {
  const admin = g.cabangId ? pickPrimary(contacts.get(g.cabangId) ?? []) : undefined;
  return (
    <div className="mb-4">
      <div className={`mb-2.5 flex flex-wrap items-center justify-between gap-2.5 border-b-2 px-0.5 pb-2 ${g.tone === "red" ? "border-[var(--red)]" : "border-[var(--ink)]"}`}>
        <div className="flex flex-wrap items-baseline gap-2">
          <b className={`font-display text-base font-extrabold ${g.tone === "red" ? "text-[var(--red)]" : ""}`}>{g.title}</b>
          <span className="text-[12.5px] text-[var(--muted)]">{g.kategori ? `${katLabel(g.kategori)} + PPN · ` : ""}{g.items.length} closing</span>
        </div>
        {admin ? <ContactLinks contact={admin} /> : g.cabangId ? <span className="text-[12px] text-[var(--muted)]">kontak belum ada (Master → Kantor)</span> : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2.5">{g.items.map((p) => <PreviewCard key={p.closingCode} p={p} offices={offices} />)}</div>
    </div>
  );
}

function PreviewCard({ p, offices }: { p: ClosingPreview; offices: OfficeOpt[] }) {
  const fresh = freshLines(p);
  const allReported = !p.error && !p.holds.length && p.lines.length > 0 && !fresh.length;
  return (
    <div className={`rounded-xl border p-3.5 ${p.error ? "border-[#F3B7BE] bg-[var(--red-50)]" : "border-[var(--line)]"} ${allReported ? "opacity-60" : ""}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[13.5px] font-semibold">{p.closingCode}</span>
        {p.cobroke && <Badge tone="blue">Co-broke</Badge>}
        {p.error && <span className="text-[13px] text-[var(--red)]">{p.error}</span>}
        {!p.error && p.holds.length > 0 && <Badge tone="red">Ditahan</Badge>}
        {isReady(p) && <Badge tone="green">Siap simpan</Badge>}
        {allReported && <Badge>Sudah dilaporkan, tidak dihitung lagi</Badge>}
      </div>
      {p.holds.length > 0 && (
        <div className="mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <div className="mb-1 font-semibold">Lengkapi master dulu (tidak ditambahkan otomatis):</div>
          <ul className="grid gap-1.5">
            {p.holds.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span>{h.kind === "agen" ? "Agen" : "Kantor"} <b>{h.name}</b> {h.code && <span className="font-mono">({h.code})</span>} belum ada di master</span>
                {h.kind === "agen"
                  ? <AgentForm label="Tambahkan ke master" triggerClass={linkBtn} offices={offices} initial={{ employee_code: h.code, name: h.name }} />
                  : <OfficeForm label="Tambahkan ke master" triggerClass={linkBtn} initial={{ office_code: h.code }} />}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.warnings.length > 0 && <ul className="mb-2 list-disc rounded-lg bg-[#FFF4DF] py-2 pl-8 pr-3 text-[12.5px] text-[var(--amber)]">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      {p.invoices.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[12px] text-[var(--muted)]">Invoice ID</span>
          {p.invoices.map((v) => p.reported.includes(v.number)
            ? <span key={v.number} title="Sudah masuk laporan, tidak dihitung lagi" className="rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2 py-0.5 font-mono text-[12px] text-[var(--muted)] line-through">{v.number}</span>
            : <span key={v.number} className="rounded-lg border border-[var(--blue-200)] bg-[var(--blue-50)] px-2 py-0.5 font-mono text-[12px] font-semibold text-[var(--blue-ink)]">{v.number}{v.totalPhase && v.totalPhase > 1 ? ` · ${v.phase}/${v.totalPhase}` : ""}</span>)}
        </div>
      )}
      {p.lines.length > 0 && (
        <div className="tw">
          <table className="t">
            <thead><tr><th>Invoice</th><th>Kantor (GC)</th><th>MA</th><th>L/S</th><th>Co-broke</th><th className="num">Komisi gross</th><th className="num">Royalti</th><th className="num">SSDF</th><th className="num">Ke RMI</th></tr></thead>
            <tbody>
              {p.lines.map((l, i) => (
                <tr key={i} className={p.reported.includes(l.invoice_number) ? "text-[var(--muted)] line-through" : undefined}>
                  <td className="font-mono text-xs">{l.invoice_number}</td>
                  <td>{l.cabang_name}</td>
                  <td>{l.ma_name}</td>
                  <td>{l.lsl}</td>
                  <td className="text-[var(--ink-2)]">{l.kantor_cobroke ? `${l.kantor_cobroke} · ${l.ma_cobroke ?? ""}` : "—"}</td>
                  <td className="num font-semibold">{fmt(l.komisi_gross)}</td>
                  <td className="num">{fmt(l.royalti)}</td>
                  <td className="num">{fmt(l.ssdf)}</td>
                  <td className="num">{fmt(l.ke_rmi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
