import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { Card, PageHeader, PeriodBadge, fmt, periodLabel } from "@/components/ui";
import { UploadForm } from "@/components/upload-form";
import { CancelUploadButton } from "@/components/line-actions";
import { loadContacts, pickPrimary } from "@/lib/closing/contacts";
import { isInputOpen, periodState, pickerPeriods } from "@/lib/closing/periods";
import { loadPeriods } from "@/lib/closing/period-data";

// Upload Excel Kantor (PLAN §9 no. 9): file template dibaca & dihitung ulang (file tidak disimpan); "Simpan" memasukkan baris ke Laporan Bulanan.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ period?: string; office?: string }> };
type Office = { id: string; cabang_name: string; report_channel: string | null; kategori: string };
type SavedRow = { cabang_id: string; komisi_gross: number; ssdf: number; royalti: number; file: string | null; offices: { cabang_name: string } | null };
type PeriodOpt = { id: string; label: string; state: "open" | "locked"; month: number; year: number };

export default async function UploadPage({ searchParams }: Props) {
  const sp = await searchParams;
  const db = supabaseClosingAdmin();
  const [o, periodsAll, contacts] = await Promise.all([
    db.from("offices").select("id,cabang_name,report_channel,kategori").eq("status", "aktif").order("cabang_name").limit(1000),
    loadPeriods(),
    loadContacts(),
  ]);
  if (o.error) throw new Error(`Gagal baca kantor: ${o.error.message}`);
  const offices = (o.data ?? []) as Office[];
  // Periode yang sudah mulai (termasuk terkunci tahun ini; tanpa periode terkunci tahun-tahun lalu), terbaru di atas.
  const periods = pickerPeriods(periodsAll)
    .map((p) => ({ id: p.id, label: periodLabel(p), state: periodState(p), month: p.month, year: p.year }))
    .filter((p): p is PeriodOpt => p.state !== "future")
    .reverse();
  const periodId = periods.some((p) => p.id === sp.period) ? sp.period! : "";
  const officeId = offices.some((x) => x.id === sp.office) ? sp.office! : "";
  const primary = Object.fromEntries(offices.flatMap((x) => {
    const c = pickPrimary(contacts.get(x.id) ?? []);
    return c ? [[x.id, { jenis: c.jenis, nama: c.nama, phone: c.phone }]] : [];
  }));

  // Daftar "Upload tersimpan": periode di URL, atau periode terbuka dengan cut-off terdekat.
  const listPeriod = periodsAll.find((p) => p.id === periodId) ?? periodsAll.find((p) => isInputOpen(p));
  const saved = new Map<string, SavedRow[]>();
  if (listPeriod) {
    const { data, error } = await db.from("commission_lines").select("cabang_id,komisi_gross,ssdf,royalti,file:original->>file,offices!cabang_id(cabang_name)")
      .eq("period_id", listPeriod.id).eq("source", "excel").is("batal_at", null).limit(5000);
    if (error) throw new Error(`Gagal baca upload tersimpan: ${error.message}`);
    for (const r of (data ?? []) as unknown as SavedRow[]) saved.set(r.cabang_id, [...(saved.get(r.cabang_id) ?? []), r]);
  }
  const listLabel = listPeriod ? periodLabel(listPeriod) : "—";
  const listOpen = listPeriod ? isInputOpen(listPeriod) : false;
  const sum = (ls: SavedRow[], k: "komisi_gross" | "ssdf" | "royalti") => ls.reduce((a, r) => a + (Number(r[k]) || 0), 0);

  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <PageHeader
        eyebrow="Input · sumber Excel"
        title="Upload Excel Kantor"
        desc={<>Untuk kantor yang lapor lewat file template <b>Perhitungan Komisi</b> (3,5% atau 9%). Sistem membaca sheet “Perhitungan Komisi” mulai baris 11 dan menghitung ulang semua rumus. Setelah dicek, <b>Simpan</b> memasukkan barisnya ke Laporan Bulanan. Upload ulang untuk kantor &amp; periode yang sama menggantikan upload sebelumnya.</>}
      />
      <UploadForm offices={offices} periods={periods} periodId={periodId} officeId={officeId} contacts={primary} savedList={
        <Card>
          <div className="flex items-center justify-between border-b border-[var(--line-2)] px-5 py-4">
            <h3 className="font-display text-[15px] font-bold">Upload tersimpan · {listLabel}</h3>
            {listPeriod ? <PeriodBadge state={periodState(listPeriod)} /> : null}
          </div>
          {saved.size ? (
            <div className="tw">
              <table className="t">
                <thead><tr><th>Kantor</th><th>File</th><th className="num">Baris</th><th className="num">Komisi</th><th className="num">SSDF</th><th className="num">Royalti</th><th /></tr></thead>
                <tbody>
                  {[...saved.entries()].map(([id, ls]) => (
                    <tr key={id}>
                      <td className="font-semibold">{ls[0].offices?.cabang_name}</td>
                      <td className="text-[12.5px] text-[var(--muted)]">{[...new Set(ls.map((l) => l.file ?? "—"))].join(", ")}</td>
                      <td className="num">{ls.length}</td>
                      <td className="num">{fmt(sum(ls, "komisi_gross"))}</td>
                      <td className="num">{fmt(sum(ls, "ssdf"))}</td>
                      <td className="num">{fmt(sum(ls, "royalti"))}</td>
                      <td>{listPeriod && listOpen ? <CancelUploadButton officeId={id} periodId={listPeriod.id} cabang={ls[0].offices?.cabang_name ?? ""} periodLabel={listLabel} /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="px-5 py-6 text-center text-[var(--muted)]">Belum ada upload di periode ini.</div>}
        </Card>
      } />
    </main>
  );
}
