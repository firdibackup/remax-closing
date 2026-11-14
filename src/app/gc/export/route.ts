import { fetchActiveLines } from "@/lib/supabase/fetch-lines";
import { gcByInduk } from "@/lib/closing/rekap";
import { gcWorkbook, xlsxResponse } from "@/lib/closing/xlsx";

// Ekspor GC Office (.xlsx, setara sheet "GC Office 2026").
export const dynamic = "force-dynamic";

export async function GET() {
  const lines = await fetchActiveLines();
  const year = lines.find((r) => r.periods)?.periods?.year ?? new Date().getFullYear();
  return xlsxResponse(gcWorkbook(gcByInduk(lines), year), `GC Office ${year}.xlsx`);
}
