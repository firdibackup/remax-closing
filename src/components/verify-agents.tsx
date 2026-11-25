"use client";

import { memo, useCallback, useDeferredValue, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { acceptSuggestions, createHistoricalAgent, resolveAgent, searchGeniusAgents, unresolveAgent, type GeniusAgentHit } from "@/app/actions/yearly";
import { Field, inputCls } from "@/components/action-dialog";
import { useReportPending } from "@/components/pending";
import { PendingButton, Spinner } from "@/components/spinner";
import { Alert } from "@/components/upload-form";
import { Badge, Card, btnCls, btnPriCls, compact, fmt, selectCls } from "@/components/ui";
import { StepHead } from "@/components/verify-offices";
import { Fold, YDialog, dangerSm, monthsLabel, norm, pctScore, smBtn, useRun } from "@/components/yearly-kit";
import type { AgentOption, AgentPair, AgentSuggestion } from "@/lib/yearly/data";

// Verifikasi bagian B: pasangan kantor + nama MA di file → agen master (Agent ID asli). Hanya menyimpan peta nama;
// baris baru masuk laporan saat Simpan ke laporan. readOnly = impor sudah final (buka kembali dulu).
// Daftar difilter di browser; tiap baris di-memo supaya mengetik di kotak cari tidak me-render ulang semua baris.

type Indexed = AgentOption & { t: string };
type CreateTarget = { pair: AgentPair; initial: { employee_code: string; name: string; full_name: string; role: string; status: string }; key: number };
const THRESHOLDS = [[1, "100% (nama sama)"], [0.98, "≥ 98%"], [0.95, "≥ 95%"]] as const;
const MAX_ROWS = 150;

const qualifies = (p: AgentPair, min: number) => {
  const [a, b] = p.suggestions;
  return !!a && a.score >= min && (!b || b.score < a.score); // sama dengan aturan server (acceptSuggestions)
};

export function VerifyAgents({ year, pairs, resolved, agents, officesPending, readOnly }: { year: number; pairs: AgentPair[]; resolved: AgentPair[]; agents: AgentOption[]; officesPending: number; readOnly?: boolean }) {
  const [office, setOffice] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(MAX_ROWS);
  const dq = useDeferredValue(q);
  const indexed = useMemo<Indexed[]>(() => agents.map((a) => ({ ...a, t: norm(`${a.fullName ?? ""} ${a.name} ${a.code} ${a.office ?? ""}`) })), [agents]);
  const officeList = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    for (const p of pairs) { const o = m.get(p.officeId) ?? { id: p.officeId, name: p.officeName, n: 0 }; o.n++; m.set(p.officeId, o); }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [pairs]);
  const shown = useMemo(() => {
    const words = norm(dq).split(" ").filter(Boolean);
    return pairs.filter((p) => (!office || p.officeId === office) && (!words.length || words.every((w) => norm(`${p.maRaw} ${p.officeName} ${p.induk}`).includes(w))));
  }, [pairs, office, dq]);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [create, setCreate] = useState<CreateTarget | null>(null);
  const openCreate = useCallback((pair: AgentPair, init: Partial<CreateTarget["initial"]> = {}) => {
    setCreate({ pair, key: Date.now(), initial: { employee_code: "", name: pair.maRaw, full_name: pair.maRaw, role: "agent_property", status: "resign", ...init } });
    requestAnimationFrame(() => dialogRef.current?.showModal());
  }, []);

  const done = !pairs.length && !officesPending;
  return (
    <Card>
      <StepHead n="B" title="MA → Agent ID" done={done}
        desc={pairs.length
          ? <>{fmt(pairs.length)} nama MA belum punya Agent ID. Urut dari GC terbesar.</>
          : officesPending ? <>Semua MA di kantor yang sudah terhubung sudah punya Agent ID. MA di {fmt(officesPending)} kantor yang belum terhubung muncul di sini setelah bagian A selesai.</>
          : <>Semua nama MA sudah punya Agent ID.</>}
        aside={pairs.length && !readOnly ? <BulkAccept year={year} pairs={pairs} /> : null} />

      {pairs.length && officesPending ? (
        <div className="px-5 pt-4"><Alert lv="amber">{fmt(officesPending)} kantor di bagian A belum terhubung. MA di kantor itu belum tampil di daftar ini, jadi jumlah MA bisa bertambah.</Alert></div>
      ) : null}

      {pairs.length ? (
        <>
          <div className="flex flex-wrap items-center gap-2.5 px-5 py-3.5">
            <select className={`${selectCls} max-w-[300px]`} value={office} onChange={(e) => { setOffice(e.target.value); setLimit(MAX_ROWS); }} aria-label="Filter kantor">
              <option value="">Semua kantor ({fmt(pairs.length)})</option>
              {officeList.map((o) => <option key={o.id} value={o.id}>{o.name} ({o.n})</option>)}
            </select>
            <input className={`${selectCls} min-w-[240px] flex-1`} placeholder="Cari nama MA atau kantor…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(MAX_ROWS); }} aria-label="Cari MA" />
            <span className="text-[12.5px] text-[var(--muted)]">{fmt(shown.length)} nama · GC {compact(shown.reduce((a, p) => a + p.gc, 0))}</span>
          </div>
          <div className={`tw tall border-t border-[var(--line-2)] ${dq !== q ? "opacity-70" : ""}`}>
            <table className="t">
              <thead><tr><th>Kantor</th><th>Nama di file</th><th className="num">Baris</th><th className="num">GC</th><th>Bulan</th><th className="min-w-[440px]">Agent ID</th></tr></thead>
              <tbody>
                {shown.slice(0, limit).map((p) => <PairRow key={`${p.officeId}|${p.nameKey}`} p={p} agents={indexed} onCreate={openCreate} readOnly={readOnly} />)}
                {!shown.length ? <tr><td colSpan={6} className="py-8 text-center text-[var(--muted)]">Tidak ada MA yang cocok dengan filter.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {shown.length > limit ? (
            <div className="border-t border-[var(--line-2)] px-5 py-3 text-center">
              <button type="button" className={btnCls} onClick={() => setLimit((l) => l + MAX_ROWS)}>Tampilkan {fmt(Math.min(MAX_ROWS, shown.length - limit))} lagi ({fmt(shown.length - limit)} tersisa)</button>
            </div>
          ) : null}
        </>
      ) : null}

      {resolved.length ? <Fold title="Sudah terverifikasi" count={resolved.length}>{() => <ResolvedList pairs={resolved} readOnly={readOnly} />}</Fold> : null}

      {readOnly ? null : <CreateAgentDialog target={create} year={year} dialogRef={dialogRef} />}
    </Card>
  );
}

// --- Terima saran massal: tampilkan dulu berapa & siapa yang ikut. ---
function BulkAccept({ year, pairs }: { year: number; pairs: AgentPair[] }) {
  const [min, setMin] = useState(0.95);
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, run] = useRun();
  const picks = useMemo(() => pairs.filter((p) => qualifies(p, min)), [pairs, min]);
  const rows = picks.reduce((a, p) => a + p.rows, 0);
  const label = min === 1 ? "100%" : `≥ ${Math.round(min * 100)}%`;
  return (
    <>
      <button type="button" className={`${btnPriCls} disabled:!bg-[var(--blue-200)]`} disabled={!pairs.some((p) => qualifies(p, 0.95))} onClick={() => ref.current?.showModal()}>
        Terima saran ≥ 95% ({fmt(pairs.filter((p) => qualifies(p, 0.95)).length)})
      </button>
      <dialog ref={ref} onCancel={(e) => { if (pending) e.preventDefault(); }} className="m-auto w-[min(720px,calc(100vw-24px))] whitespace-normal rounded-2xl border border-[var(--line)] p-0 text-left font-normal shadow-2xl backdrop:bg-black/30">
        <div className="flex flex-col gap-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--red)]">Verifikasi massal · {year}</div>
              <h2 className="font-display text-xl font-extrabold">Terima saran teratas</h2>
            </div>
            <button type="button" onClick={() => !pending && ref.current?.close()} disabled={pending} aria-label="Tutup" className="rounded-lg px-2 py-1 text-[var(--muted)] disabled:opacity-40">✕</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            Skor minimal
            <div className="inline-flex rounded-[10px] bg-[var(--line-2)] p-1">
              {THRESHOLDS.map(([v, l]) => (
                <button key={v} type="button" disabled={pending} onClick={() => setMin(v)} aria-pressed={min === v}
                  className={`rounded-lg px-3 py-1 text-[12.5px] font-semibold ${min === v ? "bg-white text-[var(--ink)] shadow-sm" : "text-[var(--muted)] hover:text-[var(--ink)]"}`}>{l}</button>
              ))}
            </div>
          </div>
          <p className="text-[13px] text-[var(--ink-2)]">
            <b>{fmt(picks.length)}</b> nama MA ({fmt(rows)} baris) akan dicocokkan ke saran teratasnya (skor {label}, tidak seri dengan saran kedua). Saran di bawah 95% (mis. “ELIS ELIS” → “ELISA ELISA”, 90%) tidak ikut: cek satu per satu.
          </p>
          {picks.length ? (
            <div className="tw max-h-[340px] rounded-lg border border-[var(--line-2)]">
              <table className="t">
                <thead><tr><th>Kantor</th><th>Nama di file</th><th>→ Agen</th><th className="num">Skor</th><th className="num">Baris</th></tr></thead>
                <tbody>
                  {picks.map((p) => { const s = p.suggestions[0]; return (
                    <tr key={`${p.officeId}|${p.nameKey}`}>
                      <td className="text-[12.5px]">{p.officeName}</td>
                      <td className="font-medium">{p.maRaw}</td>
                      <td>{s.fullName ?? s.name} <span className="font-mono text-[11.5px] text-[var(--muted)]">{s.code}</span>{s.local ? null : <span className="ml-1"><Badge tone="amber">kantor lain</Badge></span>}</td>
                      <td className="num">{pctScore(s.score)}</td>
                      <td className="num">{fmt(p.rows)}</td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          ) : <div className="rounded-lg bg-[var(--bg)] px-3 py-4 text-center text-[13px] text-[var(--muted)]">Tidak ada saran dengan skor {label}.</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="rounded-lg border border-[var(--line)] bg-white px-3.5 py-2 text-[13.5px] font-semibold disabled:opacity-50">Kembali</button>
            <PendingButton type="button" pending={pending} pendingText="Mencocokkan…" disabled={!picks.length}
              onClick={() => run(acceptSuggestions, { year: String(year), min_score: String(min) }, (r) => { if (r?.ok) ref.current?.close(); })}
              className="rounded-lg bg-[var(--blue)] px-3.5 py-2 text-[13.5px] font-semibold text-white">
              Terima {fmt(picks.length)} saran
            </PendingButton>
          </div>
        </div>
      </dialog>
    </>
  );
}

// --- Satu pasangan kantor + MA ---
const PairRow = memo(function PairRow({ p, agents, onCreate, readOnly }: { p: AgentPair; agents: Indexed[]; onCreate: (p: AgentPair, init?: Partial<CreateTarget["initial"]>) => void; readOnly?: boolean }) {
  const [pending, run] = useRun();
  const [panel, setPanel] = useState<"" | "cari" | "genius">("");
  const choose = (agentId: string) => run(resolveAgent, { office_id: p.officeId, name_key: p.nameKey, agent_id: agentId });
  const sorted = [...p.suggestions].sort((a, b) => b.score - a.score || Number(b.local) - Number(a.local));
  return (
    <tr className={pending ? "opacity-60" : ""}>
      <td className="min-w-[150px]"><div className="font-medium">{p.officeName}</div><div className="text-[11.5px] text-[var(--muted)]">{p.induk}</div></td>
      <td className="min-w-[160px] font-semibold shadow-[inset_3px_0_0_var(--amber)]">{p.maRaw}</td>
      <td className="num">{fmt(p.rows)}</td>
      <td className="num font-semibold">{fmt(p.gc)}</td>
      <td className="whitespace-nowrap text-[12px] text-[var(--muted)]" title={monthsLabel(p.months)}>{p.months.length > 4 ? `${p.months.length} bulan` : monthsLabel(p.months)}</td>
      <td className="text-[11.5px]">
        {readOnly ? <div className="text-[12px] text-[var(--muted)]">Buka kembali impor untuk mengubah.</div> : sorted.length ? (
          <div className="flex flex-wrap gap-1">
            {sorted.map((s) => <SuggestionChip key={s.agentId} s={s} disabled={pending} onClick={() => choose(s.agentId)} />)}
          </div>
        ) : <div className="text-[var(--muted)]">Tidak ada nama agen yang mirip.</div>}

        {panel === "cari" && !readOnly ? <AgentSearch p={p} agents={agents} disabled={pending} onPick={choose} onClose={() => setPanel("")} onCreate={() => onCreate(p)} /> : null}
        {panel === "genius" && !readOnly ? <GeniusSearch p={p} disabled={pending} onPick={choose} onCreate={(init) => onCreate(p, init)} onClose={() => setPanel("")} /> : null}

        {readOnly ? null : <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <button type="button" className={smBtn} disabled={pending} aria-expanded={panel === "cari"} onClick={() => setPanel((v) => (v === "cari" ? "" : "cari"))}>{panel === "cari" ? "Tutup cari" : "Cari agen"}</button>
          <button type="button" className={smBtn} disabled={pending} aria-expanded={panel === "genius"} onClick={() => setPanel((v) => (v === "genius" ? "" : "genius"))}>{panel === "genius" ? "Tutup Genius" : "Cari di Genius"}</button>
          <button type="button" className={`${smBtn} !border-[var(--blue-200)] !text-[var(--blue)]`} disabled={pending} onClick={() => onCreate(p)}>+ Buat agen baru</button>
          {pending ? <Spinner className="h-3.5 w-3.5 text-[var(--blue)]" /> : null}
        </div>}
      </td>
    </tr>
  );
});

function SuggestionChip({ s, disabled, onClick }: { s: AgentSuggestion; disabled: boolean; onClick: () => void }) {
  const strong = s.score >= 0.95;
  return (
    <button type="button" disabled={disabled} onClick={onClick} title={`Pilih ${s.fullName ?? s.name} (${s.code})`}
      className={`flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-lg border bg-white px-2 py-1 text-left text-[11.5px] hover:bg-[var(--bg)] disabled:opacity-50 ${s.local ? "border-[var(--blue-200)]" : "border-[var(--line)]"}`}>
      <b className="text-[var(--ink)]">{s.fullName ?? s.name}</b>
      <span className="font-mono text-[11px] text-[var(--muted)]">{s.code}</span>
      <span className="text-[var(--muted)]">· {s.office ?? "tanpa kantor"}</span>
      <span className={`rounded px-1 font-semibold tabular-nums ${strong ? "bg-[#E7F5EE] text-[var(--green)]" : "bg-[#FFF4DF] text-[var(--amber)]"}`}>{pctScore(s.score)}</span>
      {s.local ? <Badge tone="blue">kantor ini</Badge> : null}
      {s.role === "franchise_owner" ? <Badge tone="red">FO</Badge> : null}
      {s.status === "resign" ? <Badge>Resign</Badge> : null}
    </button>
  );
}

// Cari di semua agen master (di browser). Agen yang kantornya sama tampil tebal & di atas.
function AgentSearch({ p, agents, disabled, onPick, onClose, onCreate }: { p: AgentPair; agents: Indexed[]; disabled: boolean; onPick: (id: string) => void; onClose: () => void; onCreate: () => void }) {
  const [q, setQ] = useState(() => p.maRaw.split(/\s+/)[0] ?? "");
  const [active, setActive] = useState(0);
  const id = useId();
  const words = useMemo(() => norm(q).split(" ").filter(Boolean), [q]);
  const found = useMemo(() => {
    if (!words.length) return [];
    const hit = agents.filter((a) => words.every((w) => a.t.includes(w)));
    return hit.sort((a, b) => Number(b.office === p.officeName) - Number(a.office === p.officeName)).slice(0, 40);
  }, [agents, words, p.officeName]);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, found.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (found[active] && !disabled) onPick(found[active].id); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };
  return (
    <div className="mt-1.5 w-[min(420px,100%)] rounded-lg border border-[var(--line)] bg-white p-1.5">
      <input autoFocus role="combobox" aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={found[active] ? `${id}-${active}` : undefined} aria-label={`Cari agen untuk ${p.maRaw}`}
        className={`${inputCls} w-full !px-2 !py-1 !text-[12px]`} placeholder="Nama, Agent ID, atau kantor…" value={q} disabled={disabled}
        onChange={(e) => { setQ(e.target.value); setActive(0); }} onKeyDown={onKey} />
      <ul id={`${id}-list`} role="listbox" className="mt-1 max-h-52 overflow-y-auto">
        {found.length ? found.map((a, i) => {
          const local = a.office === p.officeName;
          return (
            <li key={a.id} id={`${id}-${i}`} role="option" aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => !disabled && onPick(a.id)}
              className={`flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 ${i === active ? "bg-[var(--blue-50)] text-[var(--blue-ink)]" : ""}`}>
              <span className={`min-w-0 truncate ${local ? "font-bold" : ""}`}>{a.fullName ?? a.name}</span>
              <span className="flex-none font-mono text-[11px] text-[var(--muted)]">{a.code}</span>
              <span className="min-w-0 truncate text-[var(--muted)]">· {a.office ?? "tanpa kantor"}</span>
              {a.role === "franchise_owner" ? <Badge tone="red">FO</Badge> : null}
              {a.status === "resign" ? <Badge>Resign</Badge> : null}
            </li>
          );
        }) : <li className="px-1.5 py-1 text-[var(--muted)]">{words.length ? "Tidak ketemu di master. Coba Cari di Genius." : "Ketik nama atau Agent ID."}</li>}
      </ul>
      <div className="mt-1 border-t border-[var(--line-2)] px-1.5 pt-1 text-[11.5px] text-[var(--muted)]">
        Tidak ketemu? <button type="button" className="font-semibold text-[var(--blue)] hover:underline disabled:opacity-50" disabled={disabled} onClick={onCreate}>+ Buat agen baru</button>
      </div>
    </div>
  );
}

// Cari Agent ID di Genius: hasil yang sudah ada di master langsung dipilih; yang belum → isi form agen baru.
function GeniusSearch({ p, disabled, onPick, onCreate, onClose }: {
  p: AgentPair; disabled: boolean; onPick: (id: string) => void; onCreate: (init: Partial<CreateTarget["initial"]>) => void; onClose: () => void;
}) {
  const [q, setQ] = useState(() => p.maRaw.split(/\s+/)[0] ?? "");
  const [res, setRes] = useState<{ ok: boolean; message: string; results: GeniusAgentHit[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useReportPending(busy);
  const search = async () => {
    if (busy) return;
    setBusy(true);
    try { setRes(await searchGeniusAgents(q)); }
    catch { setRes({ ok: false, message: "Genius tidak bisa dihubungi. Coba lagi.", results: [] }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-1.5 w-[min(460px,100%)] rounded-lg border border-[var(--line)] bg-white p-1.5">
      <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input autoFocus className={`${inputCls} min-w-0 flex-1 !px-2 !py-1 !text-[12px]`} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } }} placeholder="Satu kata nama atau Agent ID (A24277)" aria-label={`Cari di Genius untuk ${p.maRaw}`} />
        <PendingButton type="submit" pending={busy} pendingText="Mencari…" disabled={q.trim().length < 2} className={`${smBtn} !py-1`}>Cari</PendingButton>
      </form>
      <div className="mt-1 text-[11px] text-[var(--muted)]">Nama lengkap sering tidak ketemu di Genius. Cari dengan satu kata nama atau Agent ID.</div>
      {res ? (
        res.results.length ? (
          <ul className="mt-1 max-h-52 overflow-y-auto">
            {res.results.map((h) => (
              <li key={h.employeeCode} className="flex flex-wrap items-center gap-1.5 border-t border-[var(--line-2)] px-1 py-1 first:border-0">
                <span className="min-w-0 flex-1">
                  <b>{h.name ?? h.nickName ?? "—"}</b> <span className="font-mono text-[11px] text-[var(--muted)]">{h.employeeCode}</span>
                  <span className="block truncate text-[var(--muted)]">{h.officeName ?? "—"} · {h.status}</span>
                </span>
                {h.agentId
                  ? <button type="button" className={`${smBtn} !border-[var(--blue-200)] !text-[var(--blue)]`} disabled={disabled} onClick={() => onPick(h.agentId!)}>Pilih (sudah di master)</button>
                  : <button type="button" className={smBtn} disabled={disabled}
                      onClick={() => onCreate({ employee_code: h.employeeCode, name: h.nickName || h.name || p.maRaw, full_name: h.name || p.maRaw, status: /aktif|active/i.test(h.status) ? "aktif" : "resign" })}>
                      Buat agen dengan ID ini
                    </button>}
              </li>
            ))}
          </ul>
        ) : <div className={`mt-1 px-1 ${res.ok ? "text-[var(--muted)]" : "font-medium text-[var(--red)]"}`}>{res.message}</div>
      ) : null}
    </div>
  );
}

// Satu dialog untuk semua baris (lebih ringan dari dialog per baris). key = isian awal baru tiap kali dibuka.
function CreateAgentDialog({ target, year, dialogRef }: { target: CreateTarget | null; year: number; dialogRef: RefObject<HTMLDialogElement | null> }) {
  const [, run] = useRun();
  const t = target;
  return (
    <YDialog key={t?.key ?? 0} hideTrigger dialogRef={dialogRef} title={t?.pair.maRaw ?? "Agen baru"} eyebrow={t ? `Agen baru · ${t.pair.officeName}` : "Agen baru"} submit="Buat & hubungkan" action={createHistoricalAgent}
      failExtra={(r) => (r.agentId && t ? (
        <button type="button" className={`${smBtn} !text-[12px]`} onClick={() => { dialogRef.current?.close(); run(resolveAgent, { office_id: t.pair.officeId, name_key: t.pair.nameKey, agent_id: r.agentId! }); }}>
          Pakai agen yang sudah ada
        </button>
      ) : null)}>
      {t ? (
        <div className="contents">
          <input type="hidden" name="office_id" value={t.pair.officeId} />
          <input type="hidden" name="name_key" value={t.pair.nameKey} />
          <input type="hidden" name="year" value={year} />
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Field label="Agent ID (wajib)" hint="Agent ID asli dari Genius, mis. A24277">
              <input name="employee_code" defaultValue={t.initial.employee_code} required pattern="[A-Za-z0-9]{3,20}" autoFocus placeholder="A24277" className={`${inputCls} font-mono uppercase`} />
            </Field>
            <Field label="Role">
              <select name="role" defaultValue={t.initial.role} className={inputCls}><option value="agent_property">Agent Property</option><option value="franchise_owner">Franchise Owner</option></select>
            </Field>
            <Field label="Nama"><input name="name" defaultValue={t.initial.name} required className={inputCls} /></Field>
            <Field label="Nama lengkap"><input name="full_name" defaultValue={t.initial.full_name} className={inputCls} /></Field>
            <AgentStatus t={t} year={year} />
          </div>
        </div>
      ) : null}
    </YDialog>
  );
}

// Status agen baru: Aktif = masih bekerja (penugasan terbuka sejak 1 Jan tahun itu), Resign = penugasan tahun itu saja.
function AgentStatus({ t, year }: { t: CreateTarget; year: number }) {
  const [status, setStatus] = useState(t.initial.status);
  const aktif = status === "aktif";
  return (
    <>
      <Field label="Status" hint={aktif ? `Masih bekerja: penugasan di ${t.pair.officeName} mulai 1 Jan ${year}, tanpa tanggal akhir.` : `Sudah keluar: penugasan di ${t.pair.officeName} hanya sepanjang ${year}.`}>
        <select name="status" value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls}><option value="resign">Resign (data lama)</option><option value="aktif">Aktif</option></select>
      </Field>
      <p className="rounded-lg bg-[var(--blue-50)] px-3 py-2 text-[12.5px] text-[var(--blue-ink)] sm:col-span-2">
        Agen ditambahkan ke master dengan status <b>{aktif ? "Aktif" : "Resign"}</b>, lalu {fmt(t.pair.rows)} baris “{t.pair.maRaw}” dihubungkan ke agen ini (masuk laporan saat Simpan ke laporan). Tidak tahu Agent ID-nya? Pakai <b>Cari di Genius</b> dulu.
      </p>
    </>
  );
}

// --- Sudah terverifikasi: cari + batalkan (satu dialog konfirmasi bersama). ---
function ResolvedList({ pairs, readOnly }: { pairs: AgentPair[]; readOnly?: boolean }) {
  const [q, setQ] = useState("");
  const [src, setSrc] = useState<"" | "auto" | "hq">("");
  const [limit, setLimit] = useState(MAX_ROWS);
  const dq = useDeferredValue(q);
  const [target, setTarget] = useState<AgentPair | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, run] = useRun();
  const shown = useMemo(() => {
    const words = norm(dq).split(" ").filter(Boolean);
    return pairs.filter((p) => (!src || p.source === src) && (!words.length || words.every((w) => norm(`${p.maRaw} ${p.officeName} ${p.agentName ?? ""} ${p.agentCode ?? ""}`).includes(w))));
  }, [pairs, dq, src]);
  const hq = pairs.filter((p) => p.source === "hq").length;
  return (
    <>
      <div className="flex flex-wrap items-center gap-2.5 px-5 pb-3">
        <input className={`${selectCls} min-w-[240px] flex-1`} placeholder="Cari nama MA, agen, Agent ID, kantor…" value={q} onChange={(e) => { setQ(e.target.value); setLimit(MAX_ROWS); }} aria-label="Cari yang sudah terverifikasi" />
        <select className={selectCls} value={src} onChange={(e) => { setSrc(e.target.value as typeof src); setLimit(MAX_ROWS); }} aria-label="Sumber">
          <option value="">Semua ({fmt(pairs.length)})</option>
          <option value="hq">Dipilih HQ ({fmt(hq)})</option>
          <option value="auto">Otomatis ({fmt(pairs.length - hq)})</option>
        </select>
      </div>
      <div className="tw tall max-h-[480px] border-t border-[var(--line-2)]">
        <table className="t">
          <thead><tr><th>Kantor</th><th>Nama di file</th><th>Agen</th><th>Sumber</th><th className="num">Baris</th><th className="num">GC</th><th /></tr></thead>
          <tbody>
            {shown.slice(0, limit).map((p) => (
              <tr key={`${p.officeId}|${p.nameKey}`}>
                <td className="text-[12.5px]">{p.officeName}</td>
                <td className="font-medium">{p.maRaw}</td>
                <td>{p.agentName} <span className="font-mono text-[11.5px] text-[var(--muted)]">{p.agentCode}</span></td>
                <td>{p.source === "auto" ? <Badge tone="green">Otomatis</Badge> : <Badge tone="blue">HQ</Badge>}</td>
                <td className="num">{fmt(p.rows)}</td>
                <td className="num">{fmt(p.gc)}</td>
                <td>{readOnly ? null : <button type="button" className={dangerSm} disabled={pending} onClick={() => { setTarget(p); ref.current?.showModal(); }}>Batalkan</button>}</td>
              </tr>
            ))}
            {!shown.length ? <tr><td colSpan={7} className="py-6 text-center text-[var(--muted)]">Tidak ada yang cocok.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {shown.length > limit ? (
        <div className="border-t border-[var(--line-2)] px-5 py-3 text-center">
          <button type="button" className={btnCls} onClick={() => setLimit((l) => l + MAX_ROWS)}>Tampilkan lagi ({fmt(shown.length - limit)} tersisa)</button>
        </div>
      ) : null}
      <dialog ref={ref} onCancel={(e) => { if (pending) e.preventDefault(); }} className="m-auto w-[min(520px,calc(100vw-24px))] whitespace-normal rounded-2xl border border-[var(--line)] p-0 text-left font-normal shadow-2xl backdrop:bg-black/30">
        <div className="flex flex-col gap-3 p-5">
          <div>
            <div className="text-[11.5px] font-semibold uppercase tracking-[.08em] text-[var(--red)]">Batalkan verifikasi · {target?.officeName}</div>
            <h2 className="font-display text-xl font-extrabold">{target?.maRaw}</h2>
          </div>
          <p className="text-[13px] text-[var(--ink-2)]">
            “{target?.maRaw}” tidak lagi dicocokkan ke <b>{target?.agentName} ({target?.agentCode})</b>. Pasangan ini ({fmt(target?.rows ?? 0)} baris) kembali ke daftar “belum punya Agent ID”, dan Simpan ke laporan menunggu sampai dipilih lagi.
          </p>
          {target?.source === "auto" ? <p className="rounded-lg bg-[#FFF4DF] px-3 py-2 text-[12.5px] text-[var(--amber)]">Pasangan ini cocok otomatis karena namanya sama persis. Kalau tahun ini diimpor ulang, pasangan ini bisa otomatis cocok lagi.</p> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => ref.current?.close()} disabled={pending} className="rounded-lg border border-[var(--line)] bg-white px-3.5 py-2 text-[13.5px] font-semibold disabled:opacity-50">Kembali</button>
            <PendingButton type="button" pending={pending} pendingText="Memproses…" disabled={!target}
              onClick={() => target && run(unresolveAgent, { office_id: target.officeId, name_key: target.nameKey }, () => ref.current?.close())}
              className="rounded-lg bg-[var(--red)] px-3.5 py-2 text-[13.5px] font-semibold text-white">Batalkan verifikasi</PendingButton>
          </div>
        </div>
      </dialog>
    </>
  );
}
