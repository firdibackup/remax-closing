import { BULAN } from "@/components/ui";
import { fetchActiveLines, filterDataRows } from "@/lib/supabase/fetch-lines";
import { data2026Workbook, xlsxResponse } from "@/lib/closing/xlsx";

// Ekspor Data 2026 (.xlsx, kolom sheet "2026" di Master Data), filter sama dengan halaman.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const month = Number(sp.get("bulan")) || 0;
  if (!Number.isInteger(month) || month < 0 || month > 12) return new Response("Bulan tidak valid.", { status: 400 });
  const rows = filterDataRows(await fetchActiveLines(), { month, ind: sp.get("ind") || undefined, src: sp.get("src") || undefined, q: sp.get("q") || undefined });
  return xlsxResponse(data2026Workbook(rows), `Data 2026${month ? ` - ${BULAN[month - 1]}` : ""}.xlsx`);
}
