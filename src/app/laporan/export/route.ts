import { BULAN } from "@/components/ui";
import { fetchActiveLines } from "@/lib/supabase/fetch-lines";
import { loadYear } from "@/lib/closing/period-data";
import { laporanWorkbook, xlsxResponse } from "@/lib/closing/xlsx";

// Ekspor Laporan Bulanan (.xlsx, format template Perhitungan Komisi; sheet 3,5% dan 9%).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const month = Number(sp.get("bulan"));
  if (!Number.isInteger(month) || month < 1 || month > 12) return new Response("Bulan tidak valid.", { status: 400 });
  const cab = sp.get("cab") || undefined;
  const { year } = await loadYear(sp.get("tahun") ?? undefined);
  const rows = (await fetchActiveLines(year)).filter((r) => r.periods?.month === month && (!cab || r.offices?.cabang_name === cab));
  return xlsxResponse(laporanWorkbook(rows, { month, year, cab }), `Laporan Closing ${cab ?? "ALL Office"} - ${BULAN[month - 1]} ${year}.xlsx`);
}
