import { BULAN } from "@/components/ui";
import { fetchActiveLines, filterDataRows } from "@/lib/supabase/fetch-lines";
import { dataYearWorkbook, xlsxResponse } from "@/lib/closing/xlsx";
import { loadYear } from "@/lib/closing/period-data";

// Ekspor Data Tahunan (.xlsx, kolom sheet "<tahun>" di Master Data), filter sama dengan halaman.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const month = Number(sp.get("bulan")) || 0;
  if (!Number.isInteger(month) || month < 0 || month > 12) return new Response("Bulan tidak valid.", { status: 400 });
  const { year } = await loadYear(sp.get("tahun") ?? undefined);
  const rows = filterDataRows(await fetchActiveLines(year), { month, ind: sp.get("ind") || undefined, src: sp.get("src") || undefined, q: sp.get("q") || undefined });
  return xlsxResponse(dataYearWorkbook(rows, year), `Data ${year}${month ? ` - ${BULAN[month - 1]}` : ""}.xlsx`);
}
