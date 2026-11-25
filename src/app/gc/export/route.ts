import { fetchActiveLines } from "@/lib/supabase/fetch-lines";
import { gcByInduk } from "@/lib/closing/rekap";
import { loadYear } from "@/lib/closing/period-data";
import { gcWorkbook, xlsxResponse } from "@/lib/closing/xlsx";

// Ekspor GC Office satu tahun (?tahun=, .xlsx, setara sheet "GC Office <tahun>").
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { year } = await loadYear(new URL(request.url).searchParams.get("tahun") ?? undefined);
  const lines = await fetchActiveLines(year);
  return xlsxResponse(gcWorkbook(gcByInduk(lines), year), `GC Office ${year}.xlsx`);
}
