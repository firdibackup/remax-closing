import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { fetchActiveLines } from "@/lib/supabase/fetch-lines";
import { loadPeriods } from "@/lib/closing/period-data";
import { countdown, cutoffOf, periodState } from "@/lib/closing/periods";
import { Card, PageHeader, PeriodBadge, Badge, fmt, fmtWib, periodLabel } from "@/components/ui";
import { PeriodToggle } from "@/components/admin-forms";
import { BotSettingsForm } from "@/components/bot-forms";
import { isBotKeyConfigured, loadBotSettings } from "@/lib/bot/data";
import { targetPeriod } from "@/lib/bot/schedule";

// Periode & Cut-off (v8): laporan bulan X bisa diisi sampai tgl 3 bulan berikutnya 23:59 (PLAN §6), lalu terkunci. Plus log aktivitas.
export const dynamic = "force-dynamic";

type AuditRow = { id: string; action: string; entity: string; entity_id: string | null; diff: Record<string, unknown> | null; at: string };
const AUDIT_LIMIT = 200;
const DETAIL_MAX = 180;
const ACTION_LABEL: Record<string, string> = {
  kunci_otomatis: "Kunci otomatis", kunci_periode: "Kunci periode", buka_periode: "Buka kunci", rekon_status: "Status rekonsiliasi", tandai_nihil: "Tandai Nihil",
  tambah_kantor: "Tambah kantor", ubah_kantor: "Ubah kantor", hapus_kantor: "Hapus kantor", tutup_kantor: "Tutup kantor",
  tambah_agen: "Tambah agen", ubah_agen: "Ubah agen", hapus_agen: "Hapus agen", resign_agen: "Agen resign", "Transfer agen": "Pindah kantor", batal_transfer: "Batal pindah kantor",
  tambah_kontak: "Tambah kontak", ubah_kontak: "Ubah kontak", hapus_kontak: "Hapus kontak",
  "Input closing Genius": "Simpan input Genius", upload_excel: "Upload Excel", hapus_upload_excel: "Hapus upload Excel",
  ubah_baris: "Ubah baris", batal_baris: "Batalkan baris", pulihkan_baris: "Pulihkan baris",
  bot_pengaturan: "Pengaturan bot WA", bot_reminder: "Reminder WA terkirim", bot_konfirmasi: "Balasan WA kantor", agen_alias: "Nama lain agen",
  bot_ingatkan: "Minta bot ingatkan", bot_file_tidak_ada: "File Drive tidak ada", bot_batal_kirim: "Batal kirim bot", bot_lewati: "Bot tidak kirim (dicek)",
};
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;
// Ringkasan diff: hanya nilai sederhana (teks/angka), mis. "reason: koreksi · lines: 12".
const describe = (d: Record<string, unknown> | null) => {
  const text = Object.entries(d ?? {}).filter(([, v]) => ["string", "number", "boolean"].includes(typeof v)).map(([k, v]) => `${k}: ${v}`).join(" · ");
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX)}…` : text;
};

export default async function PeriodePage() {
  const [periods, lines, logRes, bot] = await Promise.all([
    loadPeriods(),
    fetchActiveLines(),
    supabaseClosingAdmin().from("audit_log").select("id,action,entity,entity_id,diff,at").order("at", { ascending: false }).limit(AUDIT_LIMIT),
    loadBotSettings(),
  ]);
  if (logRes.error) throw new Error(`Gagal baca log aktivitas: ${logRes.error.message}`);
  const logs = (logRes.data ?? []) as AuditRow[];
  const stats = new Map<string, { n: number; gc: number; rmi: number }>();
  for (const l of lines) {
    const id = l.periods?.id;
    if (!id) continue;
    const s = stats.get(id) ?? { n: 0, gc: 0, rmi: 0 };
    stats.set(id, { n: s.n + 1, gc: s.gc + (Number(l.komisi_gross) || 0), rmi: s.rmi + (Number(l.ke_rmi) || 0) });
  }
  const open = periods.filter((p) => periodState(p) === "open");
  const focus = targetPeriod(periods, new Date());
  const keyOk = isBotKeyConfigured();

  return (
    <main className="mx-auto max-w-6xl p-6">
      <PageHeader eyebrow="Pengaturan" title="Periode & Cut-off" desc="Laporan bulan X bisa diisi sampai tanggal 3 bulan berikutnya pukul 23:59 WIB, lalu terkunci otomatis. Superadmin bisa membuka kunci; setiap perubahan tercatat di log." />
      {open.length ? (
        <Card className="mb-4 flex flex-wrap items-center justify-between gap-3 p-5">
          <div>
            <div className="text-[12.5px] font-semibold text-[var(--muted)]">PERIODE TERBUKA</div>
            <div className="font-display text-[26px] font-extrabold tracking-tight">{open.map(periodLabel).join(" · ")}</div>
          </div>
          <div className="text-[13px] text-[var(--ink-2)]">Cut-off terdekat: <b>{fmtWib(cutoffOf(open[0]))} WIB</b></div>
        </Card>
      ) : null}
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-[15px] font-bold">Reminder WhatsApp (bot)</h3>
              {bot.active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}
              {keyOk ? null : <Badge tone="red">Kunci bot belum diset (BOT_API_KEY)</Badge>}
            </div>
            <p className="mt-1 max-w-2xl text-[12.5px] text-[var(--muted)]">Bot mengirim ke satu nomor per cabang: kontak utama, biasanya Admin. Kalau tidak ada, ke BO. Kantor Genius menerima daftar Closing ID untuk dikonfirmasi; kantor Excel diminta mengunggah file ke folder Drive.</p>
          </div>
          <BotSettingsForm settings={bot} />
        </div>
        <div className="mt-3 grid gap-3 text-[13px] sm:grid-cols-3">
          <div>
            <div className="text-[12px] font-semibold text-[var(--muted)]">Jadwal kirim</div>
            <div className="text-[var(--ink-2)]">tgl {bot.send_days.join(", ")} · jam {hh(bot.send_hour)} WIB</div>
          </div>
          <div>
            <div className="text-[12px] font-semibold text-[var(--muted)]">Periode fokus bot</div>
            <div className={focus ? "font-semibold" : "text-[var(--muted)]"}>{focus ? periodLabel(focus) : "tidak ada periode terbuka"}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-[var(--muted)]">Folder Drive (kantor Excel)</div>
            {bot.drive_url ? <a href={bot.drive_url} target="_blank" rel="noreferrer" className="block truncate font-semibold text-[var(--blue)] hover:underline">Buka folder Drive ↗</a> : <div className="text-[var(--muted)]">belum diisi</div>}
          </div>
        </div>
      </Card>
      <Card className="mb-4">
        <div className="tw">
          <table className="t">
            <thead><tr><th>Periode</th><th>Status</th><th>Cut-off</th><th className="num">Baris</th><th className="num">GC</th><th className="num">Ke RMI</th><th>Dikunci</th><th /></tr></thead>
            <tbody>
              {periods.map((p) => {
                const st = periodState(p);
                const cd = st === "open" ? countdown(p) : null;
                const late = p.status === "open" && st === "locked";
                const s = stats.get(p.id);
                return (
                  <tr key={p.id}>
                    <td className="font-semibold">{periodLabel(p)}</td>
                    <td>{late ? <Badge tone="amber">Lewat cut-off</Badge> : <PeriodBadge state={st} />}{p.cutoff_at && st !== "future" ? <span className="ml-1"><Badge tone="amber">manual</Badge></span> : null}</td>
                    <td className="tabular-nums">{fmtWib(cutoffOf(p))}{cd ? <div className="text-[11px] text-[var(--muted)]">sisa {cd.days} hari {cd.hours} jam</div> : null}</td>
                    <td className="num">{s ? fmt(s.n) : ""}</td>
                    <td className="num">{s ? fmt(s.gc) : ""}</td>
                    <td className="num">{s ? fmt(s.rmi) : ""}</td>
                    <td className="text-[var(--muted)]">{p.locked_at ? `${fmtWib(p.locked_at)}${p.locked_by ? ` · ${p.locked_by}` : ""}` : "—"}</td>
                    <td className="text-right">{st === "future" ? null : <PeriodToggle id={p.id} label={periodLabel(p)} locked={p.status === "locked"} />}</td>
                  </tr>
                );
              })}
              {!periods.length && <tr><td colSpan={8} className="p-10 text-center text-[var(--muted)]">Belum ada periode.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <div className="flex items-center justify-between border-b border-[var(--line-2)] px-5 py-4">
          <h3 className="font-display text-[15px] font-bold">Log aktivitas</h3>
          <span className="text-[12.5px] text-[var(--muted)]">{logs.length} catatan terbaru</span>
        </div>
        {logs.length ? (
          <div className="tw max-h-[420px]">
            <table className="t">
              <thead><tr><th>Waktu (WIB)</th><th>Aksi</th><th>Detail</th></tr></thead>
              <tbody>
                {logs.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap text-[var(--muted)]">{fmtWib(a.at)}</td>
                    <td className="whitespace-nowrap font-semibold">{ACTION_LABEL[a.action] ?? a.action}</td>
                    <td className="text-[12.5px] text-[var(--ink-2)]">{describe(a.diff) || a.entity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="px-5 py-6 text-center text-[var(--muted)]">Belum ada aktivitas.</div>}
      </Card>
    </main>
  );
}
