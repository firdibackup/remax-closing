"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState, useTransition, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReportPending } from "@/components/pending";
import { PendingButton, Spinner } from "@/components/spinner";
import { addAgentAlias, readExcel, type AgentChoice, type Level, type ReadLine, type ReadResult, type Totals } from "@/app/actions/upload";
import { Field, inputCls } from "@/components/action-dialog";
import { AgentForm } from "@/components/admin-forms";
import { ContactLinks, type ContactVal } from "@/components/contact-forms";
import { Badge, Card, PeriodBadge, SourceBadge, btnCls, btnPriCls, fmt, fmtDate, katLabel } from "@/components/ui";

// Upload Excel Kantor. File dibaca server & dihitung ulang (file-nya tidak disimpan). Setelah dicek, "Simpan" memasukkan barisnya ke Laporan Bulanan.

type Office = { id: string; cabang_name: string; report_channel: string | null; kategori: string };
type Period = { id: string; label: string; state: "open" | "locked"; month: number };
type Props = {
  offices: Office[];
  periods: Period[];
  periodId: string;
  officeId: string;
  contacts: Record<string, Pick<ContactVal, "jenis" | "nama" | "phone">>;
  savedList?: ReactNode; // kartu "Upload tersimpan" dari server
};

const TARIF: Record<string, string> = { "3.5": "Royalti 0,5% · SSDF 3%", "9": "Royalti 1% · SSDF 8%" };
const ACCEPT = ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const ICON = {
  upload: "M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 11v5M12 8h.01",
  warn: "M12 3 2 20h20zM12 10v4M12 17h.01",
  file: "M7 3h7l5 5v13H7zM14 3v5h5",
  lock: "M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4",
  check: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M8 12l3 3 5-6",
} as const;
function Ic({ name, className = "h-[18px] w-[18px]" }: { name: keyof typeof ICON; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={`flex-none ${className}`} aria-hidden>
      <path d={ICON[name]} />
    </svg>
  );
}

const ALERT: Record<Level | "green", string> = {
  amber: "bg-[#FFF4DF] text-[#6B4000]",
  red: "bg-[var(--red-50)] text-[#8A0F1B]",
  blue: "bg-[var(--blue-50)] text-[var(--blue-ink)]",
  green: "bg-[#E7F5EE] text-[#0B5333]",
};
function Alert({ lv, icon, children }: { lv: Level | "green"; icon?: keyof typeof ICON; children: ReactNode }) {
  return (
    <div role={lv === "red" ? "alert" : undefined} className={`flex items-start gap-2.5 rounded-[10px] px-3.5 py-2.5 text-[13px] ${ALERT[lv]}`}>
      <span className="mt-px"><Ic name={icon ?? (lv === "green" ? "check" : lv === "blue" ? "info" : "warn")} /></span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function UploadForm({ offices, periods, periodId: initialPeriod, officeId: initialOffice, contacts, savedList }: Props) {
  const [state, action, pending] = useActionState(readExcel, null);
  const [periodId, setPeriodId] = useState(initialPeriod);
  const [officeId, setOfficeId] = useState(initialOffice);
  const [onlyOffice, setOnlyOffice] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [hint, setHint] = useState("");
  const [intent, setIntent] = useState<"preview" | "save">("preview");
  const [confirmDup, setConfirmDup] = useState(false);
  const [navigating, startNav] = useTransition();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  useReportPending(pending || navigating);

  const office = offices.find((o) => o.id === officeId);
  const period = periods.find((p) => p.id === periodId);
  const contact = officeId ? contacts[officeId] : undefined;
  const excel = offices.filter((o) => o.report_channel === "EXCEL");
  const other = offices.filter((o) => o.report_channel !== "EXCEL");

  // Kirim manual (bukan <form action>) supaya file pilihan tetap ada setelah dibaca dan bisa dibaca ulang.
  const read = (next: { file?: File | null; periodId?: string; officeId?: string; onlyOffice?: boolean; save?: boolean } = {}) => {
    const f = next.file !== undefined ? next.file : file, o = next.officeId ?? officeId;
    if (!f || !o || pending) return;
    const fd = new FormData();
    fd.set("office_id", o);
    fd.set("period_id", next.periodId ?? periodId);
    fd.set("file", f);
    if (next.onlyOffice ?? onlyOffice) fd.set("only_office", "on");
    fd.set("intent", next.save ? "save" : "preview");
    if (next.save && confirmDup) fd.set("confirm_dup", "on");
    else setConfirmDup(false);
    setIntent(next.save ? "save" : "preview");
    setHidden(false);
    startTransition(() => action(fd));
  };
  // Pilihan ikut di URL supaya daftar "Upload tersimpan" (server) mengikuti periode dan link dari Beranda tetap cocok.
  const syncUrl = (p: string, o: string) => {
    const q = new URLSearchParams();
    if (p) q.set("period", p);
    if (o) q.set("office", o);
    startNav(() => router.replace(`/upload${q.size ? `?${q}` : ""}`, { scroll: false }));
  };
  const save = () => read({ save: true });

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!officeId) { setHint("Pilih kantor dulu."); return; }
    if (!/\.xlsx$/i.test(f.name)) { setHint("File harus .xlsx. File .xls lama: buka di Excel lalu Save As .xlsx."); return; }
    setHint("");
    setFile(f);
    read({ file: f });
  };
  const onDrag = (e: DragEvent, on: boolean) => { e.preventDefault(); if (officeId && !pending) setOver(on); };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); if (!pending) pick(e.dataTransfer.files[0]); };

  const res = hidden ? null : state;
  // Pratinjau tetap tampil walau simpan gagal (ok:false tapi lines ada).
  const ok = res && (res.ok || res.lines) ? res : null;
  const failMsg = res && !res.ok ? res.message : null;
  const reading = pending && intent === "preview";
  // Sesudah tersimpan: pindahkan URL ke periode hasil supaya daftar "Upload tersimpan" ikut periode itu.
  useEffect(() => {
    if (!state?.saved || !state.periodId) return;
    if (new URLSearchParams(window.location.search).get("period") === state.periodId) return;
    const q = new URLSearchParams({ period: state.periodId });
    if (officeId) q.set("office", officeId);
    startNav(() => router.replace(`/upload?${q}`, { scroll: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat hasil simpan baru datang
  }, [state]);

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      {/* KIRI: pilihan + drop zone */}
      <Card className="flex flex-col gap-3.5 p-5">
        <Field label="Periode laporan">
          <select className={inputCls} value={periodId} disabled={pending}
            onChange={(e) => { setPeriodId(e.target.value); syncUrl(e.target.value, officeId); read({ periodId: e.target.value }); }}>
            <option value="">Otomatis dari judul file</option>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.label}{p.state === "locked" ? " · terkunci" : ""}</option>)}
          </select>
        </Field>
        <div className="-mt-2 text-[12px]">
          {period ? <PeriodBadge state={period.state} /> : <span className="text-[var(--muted)]">Dibaca dari judul “PERHITUNGAN KOMISI PERIODE BULAN …”.</span>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Field label="Kantor">
            <select className={inputCls} value={officeId} disabled={pending}
              onChange={(e) => { setOfficeId(e.target.value); setHint(""); syncUrl(periodId, e.target.value); read({ officeId: e.target.value }); }}>
              <option value="" disabled>— Pilih kantor —</option>
              {excel.length ? <optgroup label="Lapor via Excel">{excel.map((o) => <option key={o.id} value={o.id}>{o.cabang_name} · {katLabel(o.kategori)}</option>)}</optgroup> : null}
              <optgroup label="Kantor lain">{other.map((o) => <option key={o.id} value={o.id}>{o.cabang_name} · {katLabel(o.kategori)}</option>)}</optgroup>
            </select>
          </Field>
          {office ? (
            <>
              <small className="text-[12.5px] text-[var(--muted)]">
                {TARIF[office.kategori] ? <>Pakai template <b className="text-[var(--ink)]">{katLabel(office.kategori)}</b> ({TARIF[office.kategori]})</> : "Kategori kantor belum diisi (Master → Kantor)."}
              </small>
              {contact ? <ContactLinks contact={contact} /> : <small className="text-[12.5px] text-[var(--muted)]">Admin kantor belum ada nomor (Master → Kantor).</small>}
            </>
          ) : null}
        </div>

        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={onlyOffice} disabled={pending}
            onChange={(e) => { setOnlyOffice(e.target.checked); read({ onlyOffice: e.target.checked }); }} />
          Ambil hanya baris dengan kolom Office = kantor ini
        </label>

        <input ref={inputRef} type="file" accept={ACCEPT} hidden
          onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <button type="button" disabled={pending} aria-busy={pending || undefined}
          onClick={() => (officeId ? inputRef.current?.click() : setHint("Pilih kantor dulu."))}
          onDragEnter={(e) => onDrag(e, true)} onDragOver={(e) => onDrag(e, true)} onDragLeave={(e) => onDrag(e, false)} onDrop={onDrop}
          className={`flex flex-col items-center rounded-xl border-2 border-dashed px-5 py-7 text-center transition ${
            !officeId ? "cursor-not-allowed border-[var(--line)] bg-[var(--bg)] text-[var(--muted)]"
            : pending ? "cursor-wait border-[var(--blue-200)] bg-[var(--blue-50)]"
            : over ? "border-[var(--blue)] bg-[#E5EDFB]" : "border-[var(--blue-200)] bg-[var(--blue-50)] hover:border-[var(--blue)] hover:bg-[#E5EDFB]"}`}>
          {pending ? <Spinner className="h-7 w-7 text-[var(--blue)]" /> : <Ic name="upload" className={`h-7 w-7 ${officeId ? "text-[var(--blue)]" : ""}`} />}
          <b className="mb-0.5 mt-2 block font-display text-[16px] font-bold text-[var(--ink)]">{reading ? "Membaca file…" : pending ? "Menyimpan…" : "Tarik file .xlsx ke sini"}</b>
          <span className="text-[13px] text-[var(--muted)]">{!officeId ? "Pilih kantor dulu" : reading ? "Menghitung ulang rumus" : pending ? "Memasukkan baris ke Laporan Bulanan" : "atau klik untuk memilih file template"}</span>
        </button>
        {hint ? <div role="alert" className="-mt-1.5 text-[12.5px] font-medium text-[var(--red)]">{hint}</div> : null}

        {file ? (
          <div className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-[12.5px]">
            <Ic name="file" className="h-4 w-4 text-[var(--muted)]" />
            <span className="min-w-0 flex-1 truncate font-medium" title={file.name}>{file.name}</span>
            <PendingButton type="button" pending={reading} pendingText="Membaca…" disabled={!officeId || pending} onClick={() => read()}
              className={`${btnCls} !px-2.5 !py-1 !text-[12.5px]`}>Baca ulang</PendingButton>
          </div>
        ) : null}

        <Alert lv="blue">File dibaca di tempat dan <b>tidak disimpan</b>. Baris baru masuk ke <b>Laporan Bulanan</b> setelah klik <b>Simpan</b>.</Alert>
      </Card>

      {/* KANAN: hasil baca + pembanding */}
      <div className={`flex min-w-0 flex-col gap-4 transition-opacity ${pending ? "opacity-60" : ""}`}>
        {res && !res.ok && !res.lines ? (
          <Card className="p-5">
            <Alert lv="red">
              <b>{res.message}</b>
              {res.errors?.length ? <ul className="mt-1 list-disc pl-5">{res.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            </Alert>
          </Card>
        ) : null}

        {!ok ? (
          failMsg ? null : (
            <Card className="px-5 py-12 text-center text-[var(--muted)]">
              {reading ? <span className="inline-flex items-center gap-2"><Spinner />Membaca file…</span> : (
                <><b className="block text-[var(--ink)]">Belum ada file</b>Pilih kantor, lalu tarik file template Perhitungan Komisi ke kotak upload.</>
              )}
            </Card>
          )
        ) : (
          <>
            <Result r={ok} offices={offices} onClose={() => setHidden(true)} failMsg={failMsg} saving={pending && intent === "save"} busy={pending}
              confirmDup={confirmDup} setConfirmDup={setConfirmDup} onSave={save} onReread={() => read()} month={periods.find((p) => p.id === ok.periodId)?.month} />
            <Compare r={ok} />
          </>
        )}
        <div className={navigating ? "opacity-60 transition-opacity" : ""}>{savedList}</div>
      </div>
    </div>
  );
}

type Ok = NonNullable<ReadResult>;

type ResultProps = {
  r: Ok; offices: Office[]; onClose: () => void; failMsg: string | null; saving: boolean; busy: boolean;
  confirmDup: boolean; setConfirmDup: (v: boolean) => void; onSave: () => void; onReread: () => void; month?: number;
};
function Result({ r, offices, onClose, failMsg, saving, busy, confirmDup, setConfirmDup, onSave, onReread, month }: ResultProps) {
  const lines = r.lines ?? [];
  const blocked = !!r.saveBlock || (!!r.needsConfirm && !confirmDup);
  const t = r.file;
  const kat = r.meta?.kategori;
  const noAgent = (l: ReadLine) => !l.agent;
  const unmatched = new Set(lines.filter((l) => noAgent(l) && l.ma).map((l) => l.ma.trim().toUpperCase())).size;
  const noMa = lines.filter((l) => noAgent(l) && !l.ma).length;
  const warned = lines.filter((l) => l.warns.length && !noAgent(l)).length;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line-2)] px-5 py-4">
        <div className="min-w-0">
          <h2 className="truncate font-display text-[17px] font-bold" title={r.fileName}>{r.fileName}</h2>
          <div className="text-[12.5px] text-[var(--muted)]">
            {lines.length} baris terbaca · template {kat === "?" ? "tidak standar" : kat ? katLabel(kat) : "?"} · kantor {r.officeName} · periode {r.periodLabel ?? "—"}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {unmatched && !r.saved ? <Badge tone="red">{unmatched} MA belum cocok</Badge> : null}
          {noMa && !r.saved ? <Badge tone="red">{noMa} baris tanpa MA</Badge> : null}
          {warned ? <Badge tone="amber">{warned} baris perlu dicek</Badge> : lines.length && !unmatched && !noMa ? <Badge tone="green">Semua OK</Badge> : null}
          <button type="button" className={`${btnCls} disabled:opacity-50`} disabled={busy} onClick={onClose}>Batal</button>
          <PendingButton type="button" pending={saving} pendingText="Menyimpan…" disabled={blocked || busy} onClick={onSave}
            title={r.saveBlock ?? (r.needsConfirm && !confirmDup ? "Centang konfirmasi dulu" : undefined)}
            className={`${btnPriCls} disabled:!bg-[var(--blue-200)] disabled:opacity-100`}>
            {r.saved ? "Tersimpan" : `Simpan ${lines.length} baris ke ${r.periodLabel ?? "—"}`}
          </PendingButton>
        </div>
      </div>

      {r.saved || failMsg || (r.saveBlock && !r.saved) || r.needsConfirm || r.replaces ? (
        <div className="flex flex-col gap-2 px-5 pt-4">
          {r.saved ? (
            <Alert lv="green">
              <b>{r.message}</b>{" "}
              <Link href={month ? `/laporan?bulan=${month}` : "/laporan"} className="font-semibold text-[#0B5333] underline">Lihat Laporan Bulanan</Link>
            </Alert>
          ) : null}
          {failMsg ? <Alert lv="red"><b>{failMsg}</b></Alert> : null}
          {r.saveBlock && !r.saved ? (
            r.periodState === "locked"
              ? <Alert lv="red" icon="lock">Periode {r.periodLabel} terkunci. {r.saveBlock}</Alert>
              : <Alert lv="amber" icon="lock">Belum bisa disimpan: {r.saveBlock}</Alert>
          ) : null}
          {r.needsConfirm && !r.saved ? (
            <label className="flex items-start gap-2 rounded-[10px] border border-[var(--red-50)] bg-white px-3.5 py-2.5 text-[13px] font-medium">
              <input type="checkbox" name="confirm_dup" className="mt-0.5" checked={confirmDup} disabled={busy} onChange={(e) => setConfirmDup(e.target.checked)} />
              Saya sudah cek, data ini bukan dobel — tetap simpan
            </label>
          ) : null}
          {r.replaces && !r.saved && !r.saveBlock ? <p className="text-[12.5px] text-[var(--muted)]">Simpan akan mengganti {r.replaces} baris upload Excel sebelumnya untuk kantor &amp; periode ini.</p> : null}
        </div>
      ) : null}

      {r.meta && (r.meta.company || r.meta.office || r.meta.title) ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 border-b border-[var(--line-2)] bg-[#fafbfc] px-5 py-2.5 text-[12.5px]">
          {r.meta.company ? <div><dt className="inline text-[var(--muted)]">Perusahaan </dt><dd className="inline font-medium">{r.meta.company}</dd></div> : null}
          {r.meta.office ? <div><dt className="inline text-[var(--muted)]">Kantor di file </dt><dd className="inline font-medium">{r.meta.office}</dd></div> : null}
          {r.meta.title ? <div><dt className="inline text-[var(--muted)]">Judul </dt><dd className="inline font-medium">{r.meta.title}</dd></div> : null}
          {r.meta.royalty !== null || r.meta.ssdf !== null ? (
            <div><dt className="inline text-[var(--muted)]">Tarif di file </dt><dd className="inline font-medium">Royalti {pct(r.meta.royalty)} · SSDF {pct(r.meta.ssdf)}</dd></div>
          ) : null}
        </dl>
      ) : null}

      {r.issues?.length ? (
        <div className="flex flex-col gap-2 px-5 pt-4">
          {r.issues.map((x, i) => <Alert key={i} lv={x.lv}>{x.t}</Alert>)}
        </div>
      ) : null}

      <div className="p-5">
        {lines.length ? (
          <div className="tw tall rounded-lg border border-[var(--line-2)]">
            <table className="t">
              <thead>
                <tr><th>Baris</th><th>Tanggal</th><th>Office</th><th>MA</th><th>L/S</th><th>P/S/R</th><th className="num">Nilai Transaksi</th><th className="num">Komisi Gross</th><th className="num">Royalti</th><th className="num">SSDF</th><th className="num">Ke RMI</th><th>Cek</th></tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const w = l.warns.length > 0;
                  const miss = noAgent(l) && !r.saved;
                  const bg = miss ? "!bg-[#FFF6F6]" : w ? "!bg-[#FFFCF4]" : "";
                  return (
                    <tr key={l.row}>
                      <td className={`${bg} text-[var(--muted)]`}>{l.row}</td>
                      <td className={`${bg} whitespace-nowrap`}><Tanggal tanggal={l.tanggal} raw={l.tanggalRaw} warns={l.warns} /></td>
                      <td className={bg}>{l.office || "—"}</td>
                      <td className={`${bg} ${miss ? "shadow-[inset_3px_0_0_var(--red)]" : ""}`}>
                        <div className={`flex flex-wrap items-center gap-1.5 font-medium ${miss ? "text-[var(--red)]" : ""}`}>
                          {l.ma || "—"}
                          {miss ? <Badge tone="red">{l.ma ? "Belum cocok" : "MA kosong"}</Badge> : null}
                        </div>
                        {l.agent && l.agent.toUpperCase() !== l.ma.toUpperCase() ? <div className="text-[11.5px] text-[var(--muted)]">{l.agent}</div> : null}
                        {miss && l.ma ? (
                          <MatchAgent ma={l.ma} suggestions={l.suggestions} choices={r.agentChoices ?? []} offices={offices}
                            officeId={r.officeId} busy={busy} onDone={onReread} />
                        ) : null}
                      </td>
                      <td className={bg}>{l.lsl || "—"}</td>
                      <td className={bg}>{l.psr || "—"}</td>
                      <td className={`${bg} num`}>{fmt(l.nilai)}</td>
                      <td className={`${bg} num font-semibold`}>{fmt(l.komisi)}</td>
                      <td className={`${bg} num`}>{fmt(l.royalti)}</td>
                      <td className={`${bg} num`}>{fmt(l.ssdf)}</td>
                      <td className={`${bg} num`}>{fmt(l.keRmi)}</td>
                      <td className={`${bg} min-w-[200px]`}>
                        {w ? l.warns.map((x) => <div key={x} className={`text-[12px] leading-snug ${miss ? "text-[var(--red)]" : "text-[var(--amber)]"}`}>⚠ {x}</div>)
                          : miss ? <div className="text-[12px] leading-snug text-[var(--red)]">⚠ Agen belum cocok</div> : <Badge tone="green">OK</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {t ? (
                <tfoot>
                  <tr>
                    <td colSpan={7}>Total {t.rows} baris</td>
                    <td className="num">{fmt(t.komisi)}</td><td className="num">{fmt(t.royalti)}</td><td className="num">{fmt(t.ssdf)}</td><td className="num">{fmt(t.keRmi)}</td><td />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        ) : <div className="py-6 text-center text-[var(--muted)]">Tidak ada baris komisi untuk kantor ini di file.</div>}
      </div>
    </Card>
  );
}

// Nama MA di file tidak cocok dengan agen mana pun: pilih saran, cari agen, atau tambah agen baru.
// Agen yang dipilih → nama di file disimpan sebagai nama lain agen itu, lalu file dibaca ulang (semua baris dengan nama sama ikut cocok).
const smBtn = `${btnCls} !px-2 !py-0.5 !text-[11.5px] disabled:opacity-50`;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function MatchAgent({ ma, suggestions, choices, offices, officeId, busy, onDone }: {
  ma: string; suggestions?: ReadLine["suggestions"]; choices: AgentChoice[]; offices: Office[]; officeId?: string; busy: boolean; onDone: () => void;
}) {
  const [saving, startSave] = useTransition();
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const id = useId();
  const sorted = [...(suggestions ?? [])].sort((a, b) => Number(b.local) - Number(a.local));
  const words = norm(q).split(" ").filter(Boolean);
  const found = (words.length ? choices.filter((c) => { const t = norm(`${c.name} ${c.office ?? ""}`); return words.every((w) => t.includes(w)); }) : choices).slice(0, 50);
  const off = saving || busy;

  const choose = (agentId: string) => startSave(async () => {
    setErr("");
    const res = await addAgentAlias(agentId, ma);
    if (!res.ok) { setErr(res.message); return; }
    setOpen(false);
    onDone();
  });
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, found.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (found[active] && !off) choose(found[active].id); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  };

  return (
    <div className="mt-1.5 w-[230px] text-[11.5px]">
      {sorted.length ? (
        <>
          <div className="text-[var(--muted)]">Mungkin maksudnya:</div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {sorted.map((s) => (
              <button key={s.id} type="button" disabled={off} onClick={() => choose(s.id)}
                title={s.local ? "Agen kantor ini" : undefined}
                className={`${smBtn} ${s.local ? "!font-bold" : "!font-normal"}`}>
                {s.name} · {s.office ?? "kantor lain"}
              </button>
            ))}
          </div>
        </>
      ) : null}

      {open ? (
        <div className="mt-1.5 rounded-lg border border-[var(--line)] bg-white p-1.5">
          <input autoFocus role="combobox" aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list"
            aria-activedescendant={found[active] ? `${id}-${active}` : undefined} aria-label={`Cari agen untuk ${ma}`}
            className={`${inputCls} !px-2 !py-1 !text-[12px]`} placeholder="Ketik nama agen…" value={q} disabled={saving}
            onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} />
          <ul id={`${id}-list`} role="listbox" className="mt-1 max-h-44 overflow-y-auto">
            {found.length ? found.map((c, i) => (
              <li key={c.id} id={`${id}-${i}`} role="option" aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => !off && choose(c.id)}
                className={`cursor-pointer truncate rounded px-1.5 py-1 ${i === active ? "bg-[var(--blue-50)] text-[var(--blue-ink)]" : ""} ${c.local ? "font-bold" : ""}`}
                title={c.local ? "Agen kantor ini" : undefined}>
                {c.name} <span className="font-normal text-[var(--muted)]">· {c.office ?? "tanpa kantor"}</span>
              </li>
            )) : <li className="px-1.5 py-1 text-[var(--muted)]">Tidak ketemu. Tambah agen baru di bawah.</li>}
          </ul>
        </div>
      ) : null}

      <div className="mt-1 flex flex-wrap items-center gap-1">
        <button type="button" className={smBtn} disabled={off} aria-expanded={open} onClick={() => { setOpen((v) => !v); setQ(""); setActive(0); }}>
          {open ? "Tutup" : "Cari agen"}
        </button>
        <AgentForm label="+ Tambah agen baru" triggerClass={smBtn} offices={offices} officeId={officeId}
          initial={{ name: ma, full_name: ma, sheet_name: ma }} onSuccess={onDone} />
        {saving ? <Spinner className="h-3.5 w-3.5 text-[var(--blue)]" /> : null}
      </div>
      {err ? <div role="alert" className="mt-0.5 font-medium text-[var(--red)]">{err}</div> : null}
      <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted)]">Nama di file disimpan sebagai nama lain agen ini, jadi bulan depan langsung cocok.</div>
    </div>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`);
const COLS: [keyof Omit<Totals, "rows">, string][] = [["komisi", "Komisi Gross"], ["royalti", "Royalti"], ["ssdf", "SSDF"], ["keRmi", "Ke RMI"]];

function Compare({ r }: { r: Ok }) {
  const f = r.file, s = r.system;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line-2)] px-5 py-4">
        <h3 className="font-display text-[15px] font-bold">Pembanding data sistem · {r.periodLabel ?? "periode belum dipilih"}</h3>
        {r.periodState === "open" || r.periodState === "locked" ? <PeriodBadge state={r.periodState} /> : null}
      </div>
      {!f || !s ? (
        <div className="px-5 py-6 text-center text-[var(--muted)]">Periode tidak ditemukan dari judul file. Pilih periode di kiri untuk membandingkan dengan data sistem.</div>
      ) : (
        <>
          <div className="tw">
            <table className="t">
              <thead><tr><th /><th className="num">Baris</th>{COLS.map(([, h]) => <th key={h} className="num">{h}</th>)}</tr></thead>
              <tbody>
                <tr><td className="font-semibold">File ini</td><td className="num">{f.rows}</td>{COLS.map(([k]) => <td key={k} className="num">{fmt(f[k])}</td>)}</tr>
                <tr><td className="font-semibold">Sudah di sistem</td><td className="num">{s.rows}</td>{COLS.map(([k]) => <td key={k} className="num">{fmt(s[k])}</td>)}</tr>
              </tbody>
              <tfoot>
                <tr>
                  <td>Selisih (file − sistem)</td>
                  <td className="num">{diff(f.rows - s.rows, true)}</td>
                  {COLS.map(([k]) => <td key={k} className="num">{diff(f[k] - s[k])}</td>)}
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-2 px-5 py-3 text-[12.5px] text-[var(--muted)]">
            {s.rows ? (
              <>Sumber data sistem:{Object.entries(s.bySource).map(([src, n]) => <span key={src} className="inline-flex items-center gap-1"><SourceBadge source={src} /><b className="text-[var(--ink)]">{n}</b></span>)}</>
            ) : <>Belum ada data {r.officeName} di sistem untuk periode ini.</>}
          </div>
        </>
      )}
    </Card>
  );
}

function diff(v: number, count = false) {
  if (Math.abs(v) <= (count ? 0 : 2)) return <span className="text-[var(--green)]">0</span>;
  return <span className="text-[var(--amber)]">{v > 0 ? "+" : "−"}{fmt(Math.abs(v))}</span>;
}

// Tanggal: hasil baca; bila hasil tebakan dari tulisan yang salah ketik, beri tanda amber + tulisan aslinya.
function Tanggal({ tanggal, raw, warns }: { tanggal: string | null; raw: string; warns: string[] }) {
  if (!tanggal) return <span className="font-medium text-[var(--amber)]">{raw || "kosong"}</span>;
  const guessed = raw && warns.some((w) => w.startsWith("Tanggal") && w.includes("dibaca sebagai"));
  if (!guessed) return <>{fmtDate(tanggal)}</>;
  return (
    <span title={`Di file: “${raw}”`}>
      {fmtDate(tanggal)}
      <span className="ml-1 rounded bg-[#FFF4DF] px-1 text-[11px] font-semibold text-[var(--amber)]">?</span>
      <div className="text-[11px] text-[var(--amber)]">file: {raw}</div>
    </span>
  );
}
