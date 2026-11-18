// Baris impor Excel (Jan–Sep) tidak punya nomor invoice, jadi cek dobel per invoice tidak menangkapnya.
// Cocokkan baris pratinjau dengan baris impor: kantor sama, bulan transaksi sama, komisi gross sama.
// ponytail: heuristik (bukan kunci unik) → hanya peringatan; dua transaksi sah berkomisi sama di bulan yang sama tetap tertandai.

export type PreviewLineKey = { cabang_id: string; tanggal_transaksi: string; komisi_gross: number };
export type ImportRow = { cabang_id: string; komisi_gross: number | string; ma_name: string | null; year: number; month: number };

const monthKey = (cabang: string, year: number, month: number, komisi: number) => `${cabang}|${year}-${month}|${Math.round(komisi)}`;

export function importDuplicateWarnings(lines: PreviewLineKey[], imports: ImportRow[]): string[] {
  const byKey = new Map<string, string[]>();
  for (const r of imports) {
    const k = monthKey(r.cabang_id, r.year, r.month, Number(r.komisi_gross));
    byKey.set(k, [...(byKey.get(k) ?? []), r.ma_name ?? "—"]);
  }
  const out = new Set<string>();
  for (const l of lines) {
    const [y, m] = l.tanggal_transaksi.split("-").map(Number);
    const hit = byKey.get(monthKey(l.cabang_id, y, m, l.komisi_gross));
    if (hit) out.add(`Kemungkinan sudah ada di data impor ${String(m).padStart(2, "0")}/${y}: komisi ${Math.round(l.komisi_gross).toLocaleString("id-ID")} (MA impor: ${[...new Set(hit)].join(", ")}). Cek dulu sebelum simpan.`);
  }
  return [...out];
}
