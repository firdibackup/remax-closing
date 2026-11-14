"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PosterEntry } from "@/lib/top-ma/data";
import { uploadMaPhoto, refreshMaPhoto } from "@/app/actions/top-ma";
import { ActionDialog, Field, inputCls } from "@/components/action-dialog";
import { DownloadButton } from "@/components/pending";
import { Spinner } from "@/components/spinner";
import { Badge, Card, btnCls, btnPriCls, compact } from "@/components/ui";

// Editor poster Top 10 MA: daftar 10 slot (foto + teks) di kiri, pratinjau poster di kanan.
// Teks hanya ikut di URL gambar (tidak disimpan); foto disimpan per agen lewat server action.

const MAX_TEXT = 60;
const DEBOUNCE_MS = 600;
const PREVIEW_W = 1000;
// Kotak-kotak hangat supaya bagian transparan foto kelihatan.
const CHECKER: CSSProperties = { background: "repeating-conic-gradient(#EADFC4 0 25%, #FBF7EC 0 50%) 0 0 / 12px 12px" };
const smBtn = `${btnCls} !px-2.5 !py-1 !text-[12.5px]`;

type Filters = Record<string, string>;
type Texts = { name: string[]; office: string[] };

// Hanya teks yang berbeda dari default yang dikirim (kosong = pakai default).
function textParams(entries: PosterEntry[], t: Texts) {
  const out: [string, string][] = [];
  entries.forEach((e, i) => {
    const n = t.name[i].trim(), o = t.office[i].trim();
    if (n && n !== e.name) out.push([`name${i + 1}`, n]);
    if (o && o !== e.office) out.push([`office${i + 1}`, o]);
  });
  return out;
}

// Versi pendek dari waktu update foto: berubah setelah upload / ambil ulang → pratinjau dimuat ulang.
function photoVersion(entries: PosterEntry[]) {
  let h = 0;
  for (const c of entries.map((e) => `${e.agentId}:${e.photo.updatedAt ?? ""}:${e.photo.path ?? ""}`).join("|")) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (h >>> 0).toString(36);
}

export function PosterEditor({ entries, filters, label }: { entries: PosterEntry[]; filters: Filters; label: string }) {
  const [texts, setTexts] = useState<Texts>(() => ({ name: entries.map((e) => e.name), office: entries.map((e) => e.office) }));
  const params = useMemo(() => textParams(entries, texts), [entries, texts]);
  const key = JSON.stringify(params);
  const [debounced, setDebounced] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(key), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [key]);

  const version = photoVersion(entries);
  const [retry, setRetry] = useState(0);
  const previewSrc = `/top-ma/poster/image?${new URLSearchParams([...Object.entries(filters), ...(JSON.parse(debounced) as [string, string][]), ["w", String(PREVIEW_W)], ["v", version], ...(retry ? [["r", String(retry)] as [string, string]] : [])])}`;
  const downloadHref = (format: "png" | "jpg") => `/top-ma/poster/image?${new URLSearchParams([...Object.entries(filters), ...params, ["format", format], ["download", "1"], ["v", version]])}`;

  const set = (field: keyof Texts, i: number, v: string) => setTexts((t) => ({ ...t, [field]: t[field].map((x, j) => (j === i ? v : x)) }));
  const edited = params.length > 0;
  const ready = entries.filter((e) => e.photo.path && e.photo.transparent).length;

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
      {/* KIRI: 10 slot */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line-2)] px-5 py-4">
          <div>
            <h2 className="font-display text-[17px] font-bold">Isi poster</h2>
            <div className="text-[12.5px] text-[var(--muted)]">{entries.length} MA teratas · {ready}/{entries.length} foto siap (cutout)</div>
          </div>
          {edited ? (
            <button type="button" className={smBtn} onClick={() => setTexts({ name: entries.map((e) => e.name), office: entries.map((e) => e.office) })}>
              Kembalikan teks awal
            </button>
          ) : null}
        </div>
        <ol className="divide-y divide-[var(--line-2)]">
          {entries.map((e, i) => (
            <Slot key={e.rank} e={e} name={texts.name[i]} office={texts.office[i]}
              onName={(v) => set("name", i, v)} onOffice={(v) => set("office", i, v)} />
          ))}
        </ol>
        <div className="border-t border-[var(--line-2)] bg-[#fafbfc] px-5 py-3.5 text-[12.5px] leading-relaxed text-[var(--muted)]">
          <b className="text-[var(--ink-2)]">Catatan.</b> Nama di poster awalnya nama panggilan dari master; perubahan di sini hanya untuk poster ini dan tidak disimpan.
          Foto disimpan per agen dan dipakai lagi di bulan berikutnya. Foto upload manual selalu dipakai lebih dulu daripada foto Genius.
        </div>
      </Card>

      {/* KANAN: pratinjau + unduh */}
      <div className="flex flex-col gap-3 lg:sticky lg:top-6">
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-[15px] font-bold">Pratinjau</h2>
            <span className="text-[12px] text-[var(--muted)]">4018 × 5440 px</span>
          </div>
          <Preview key={previewSrc} src={previewSrc} label={label} pendingEdit={key !== debounced} onRetry={() => setRetry((r) => r + 1)} />
          <div className="no-print mt-4 flex flex-wrap gap-2">
            <DownloadButton href={downloadHref("png")} className={btnPriCls}>Download PNG</DownloadButton>
            <DownloadButton href={downloadHref("jpg")} className={btnCls}>Download JPG</DownloadButton>
          </div>
          <p className="mt-2 text-[12px] text-[var(--muted)]">Ukuran penuh, butuh sekitar 10–15 detik. PNG untuk kualitas terbaik; JPG lebih kecil untuk WhatsApp.</p>
        </Card>
      </div>
    </div>
  );
}

// Gambar pratinjau dengan status memuat. key = src, jadi status otomatis mulai ulang tiap src berubah.
function Preview({ src, label, pendingEdit, onRetry }: { src: string; label: string; pendingEdit: boolean; onRetry: () => void }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const loading = state === "loading" || pendingEdit;
  return (
    <div className="relative overflow-hidden rounded-lg border border-[var(--line)] bg-[#1b1b1f]" style={{ aspectRatio: "4018 / 5440" }} aria-busy={loading || undefined}>
      {/* Gambar dinamis dari route handler; next/image tidak perlu di sini. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={`Pratinjau poster Top 10 MA ${label}`} className={`h-full w-full object-contain transition-opacity duration-300 ${state === "ok" ? "opacity-100" : "opacity-0"}`}
        ref={(el) => { if (el?.complete && el.naturalWidth && state === "loading") setState("ok"); }}
        onLoad={() => setState("ok")} onError={() => setState("error")} />
      {state === "loading" ? <div className="sk absolute inset-0 !rounded-none opacity-20" aria-hidden /> : null}
      {loading && state !== "error" ? (
        <div role="status" className="absolute inset-x-0 bottom-3 mx-auto flex w-max items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-[12.5px] font-medium text-white">
          <Spinner />{pendingEdit ? "Menunggu ketikan selesai…" : "Membuat pratinjau…"}
        </div>
      ) : null}
      {state === "error" ? (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-[13px] text-white/85">
          Pratinjau gagal dibuat.
          <button type="button" onClick={onRetry} className={smBtn}>Coba lagi</button>
        </div>
      ) : null}
    </div>
  );
}

function PhotoStatus({ e }: { e: PosterEntry }) {
  const p = e.photo;
  const src = p.state === "manual" ? "Upload" : p.state === "genius" ? "Genius" : null;
  if (!e.agentId) return <><Badge tone="gray">Tidak di master</Badge><Hint>{p.note ?? "Agen belum ada di master; foto tidak bisa di-upload."}</Hint></>;
  if (p.path && p.transparent) return <><Badge tone="green">Cutout ✓</Badge>{src ? <Badge tone="gray">{src}</Badge> : null}</>;
  if (p.path) return <><Badge tone="amber">Perlu cutout</Badge>{src ? <Badge tone="gray">{src}</Badge> : null}<Hint>Latar foto masih ada; upload PNG transparan.</Hint></>;
  return <><Badge tone="red">Tidak ada foto</Badge>{p.note ? <Hint>{p.note}</Hint> : null}</>;
}
const Hint = ({ children }: { children: string }) => <span className="basis-full text-[12px] leading-snug text-[var(--muted)]">{children}</span>;

function Slot({ e, name, office, onName, onOffice }: { e: PosterEntry; name: string; office: string; onName: (v: string) => void; onOffice: (v: string) => void }) {
  const thumb = e.agentId && e.photo.path ? `/top-ma/foto/${e.agentId}?v=${encodeURIComponent(e.photo.updatedAt ?? "")}` : null;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 px-5 py-4 sm:grid-cols-[auto_auto_minmax(0,1fr)]">
      <div className={`grid h-8 w-8 place-items-center rounded-full font-display text-[14px] font-extrabold ${e.rank === 1 ? "bg-[var(--red)] text-white" : e.rank <= 3 ? "bg-[var(--blue)] text-white" : "bg-[var(--line-2)] text-[var(--ink-2)]"}`}
        aria-label={`Peringkat ${e.rank}`}>{e.rank}</div>
      <div className="row-span-2 hidden h-[104px] w-[78px] overflow-hidden rounded-lg border border-[var(--line)] sm:block" style={CHECKER}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {thumb ? <img src={thumb} alt={`Foto ${e.ma}`} loading="lazy" className="h-full w-full object-cover object-top" />
          : <div className="grid h-full place-items-center text-[11px] text-[var(--muted)]">Tanpa foto</div>}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <b className="truncate text-[14.5px]">{e.ma}</b>
          <span className="text-[12.5px] text-[var(--muted)]">{e.induk} · GC {compact(e.gc)}</span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5"><PhotoStatus e={e} /></div>
      </div>
      <div className="col-span-2 flex min-w-0 flex-col gap-3 sm:col-span-1 sm:col-start-3">
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Nama di poster">
            <input className={inputCls} value={name} maxLength={MAX_TEXT} placeholder={e.name} onChange={(ev) => onName(ev.target.value)} />
          </Field>
          <Field label="Kantor">
            <input className={inputCls} value={office} maxLength={MAX_TEXT} placeholder={e.office} onChange={(ev) => onOffice(ev.target.value)} />
          </Field>
        </div>
        {e.agentId ? (
          <div className="no-print flex flex-wrap gap-2">
            <UploadPhoto agentId={e.agentId} ma={e.ma} />
            <ActionDialog label="Ambil ulang dari Genius" triggerClass={smBtn} eyebrow={`#${e.rank} · ${e.ma}`} title="Ambil ulang foto dari Genius"
              action={refreshMaPhoto} submit="Ambil ulang" pendingText="Mengambil…">
              <input type="hidden" name="agent_id" value={e.agentId} />
              <p className="text-[13.5px] text-[var(--ink-2)]">
                Foto profil {e.ma} diambil lagi dari Genius{e.photo.state === "manual" ? <>; <b>foto upload yang sekarang akan diganti</b> (kalau Genius tidak punya foto, foto upload tetap dipakai)</> : null}.
              </p>
            </ActionDialog>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function UploadPhoto({ agentId, ma }: { agentId: string; ma: string }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const reset = () => {
    setPreview(null);
    setErr("");
    if (inputRef.current) inputRef.current.value = "";
  };
  return (
    <ActionDialog label="Upload foto" triggerClass={smBtn} eyebrow={ma} title="Upload foto poster" action={uploadMaPhoto} submit="Simpan foto"
      pendingText="Mengunggah…" onSuccess={reset}>
      <input type="hidden" name="agent_id" value={agentId} />
      <div className="flex gap-4">
        <div className="h-[132px] w-[100px] flex-none overflow-hidden rounded-lg border border-[var(--line)]" style={CHECKER}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview ? <img src={preview} alt="Foto yang dipilih" className="h-full w-full object-cover object-top" />
            : <div className="grid h-full place-items-center px-2 text-center text-[11px] text-[var(--muted)]">Belum dipilih</div>}
        </div>
        <div className="min-w-0 flex-1">
          <Field label="File foto" hint="PNG cutout transparan, setengah badan. JPG boleh, maks 5 MB.">
            <input ref={inputRef} type="file" name="photo" accept=".png,.jpg,.jpeg,image/png,image/jpeg" required
              className={`${inputCls} file:mr-3 file:rounded-md file:border-0 file:bg-[var(--blue-50)] file:px-2.5 file:py-1 file:text-[12.5px] file:font-semibold file:text-[var(--blue-ink)]`}
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                setErr(f && f.size > 5 * 1024 * 1024 ? "File lebih dari 5 MB." : f && !/\.(png|jpe?g)$/i.test(f.name) ? "File harus PNG atau JPG." : "");
                setPreview(f ? URL.createObjectURL(f) : null);
              }} />
          </Field>
          {err ? <div role="alert" className="mt-1.5 text-[12.5px] font-medium text-[var(--red)]">{err}</div> : null}
        </div>
      </div>
    </ActionDialog>
  );
}
