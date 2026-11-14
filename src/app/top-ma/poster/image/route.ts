import { BULAN } from "@/components/ui";
import { loadPosterEntries, parseRole } from "@/lib/top-ma/data";
import { posterMonth } from "@/lib/top-ma/format";
import { downloadPhoto } from "@/lib/top-ma/photos";
import { renderPoster, type PosterTemplate } from "@/lib/top-ma/render";

// Gambar poster Top MA All Office (poster per office memakai template lain, belum ada).
//   ?t=top10|top50 (default top10; Top 50 = peringkat 11–50) &bulan=1..12 (wajib) &role=<agent_property|franchise_owner>
//   &name<peringkat> / &office<peringkat>  → teks pengganti, mis. name1, office12 (kosong = default dari master)
//   &format=png|jpg (default png) &w=<lebar pratinjau, px> &download=1 (unduh sebagai file)
export const dynamic = "force-dynamic";

const MAX_TEXT = 60;
const PREVIEW_MIN = 200;
const TITLE: Record<PosterTemplate, string> = { top10: "Top 10 MA", top50: "Top 50 MA" };

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const template: PosterTemplate = sp.get("t") === "top50" ? "top50" : "top10";
  const month = Number(sp.get("bulan"));
  if (!Number.isInteger(month) || month < 1 || month > 12) return new Response("Bulan tidak valid.", { status: 400 });
  const role = parseRole(sp.get("role") ?? undefined);
  const format = sp.get("format") === "jpg" ? "jpg" : "png";
  const w = Number(sp.get("w")) || 0;
  const width = w >= PREVIEW_MIN ? Math.floor(w) : undefined;

  const { year, entries } = await loadPosterEntries({ month, role }, template);
  if (!entries.length) return new Response(template === "top50" ? "Belum ada MA di peringkat 11–50 bulan ini." : "Belum ada MA closing di bulan ini.", { status: 404 });
  const text = (k: string, fallback: string) => (sp.get(k) ?? "").trim().slice(0, MAX_TEXT) || fallback;
  const slots = await Promise.all(entries.map(async (e) => ({
    name: text(`name${e.rank}`, e.name),
    office: text(`office${e.rank}`, e.office),
    photo: e.photo.path ? await downloadPhoto(e.photo.path) : null,
  })));

  const img = await renderPoster({ template, month: posterMonth(month, year), slots }, { format, width });
  const filename = `${TITLE[template]} ${BULAN[month - 1]} ${year}.${format}`;
  const headers: Record<string, string> = { "Content-Type": format === "jpg" ? "image/jpeg" : "image/png", "Cache-Control": "private, no-store" };
  if (sp.get("download")) headers["Content-Disposition"] = `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return new Response(new Uint8Array(img), { headers });
}
