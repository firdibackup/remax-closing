import { BULAN } from "@/components/ui";
import { loadPosterEntries, parseRole, POSTER_SIZE } from "@/lib/top-ma/data";
import { posterMonth } from "@/lib/top-ma/format";
import { downloadPhoto } from "@/lib/top-ma/photos";
import { renderPoster } from "@/lib/top-ma/render";

// Gambar poster Top 10 MA.
//   ?bulan=1..12 (wajib) &ind=<office induk> &role=<agent_property|franchise_owner>  → filter sama dengan halaman Top MA
//   &name1..name10 / &office1..office10  → teks pengganti per peringkat (kosong = default dari master)
//   &format=png|jpg (default png) &w=<lebar pratinjau, px> &download=1 (unduh sebagai file)
export const dynamic = "force-dynamic";

const MAX_TEXT = 60;
const PREVIEW_MIN = 200;

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const month = Number(sp.get("bulan"));
  if (!Number.isInteger(month) || month < 1 || month > 12) return new Response("Bulan tidak valid.", { status: 400 });
  const ind = sp.get("ind") || undefined;
  const role = parseRole(sp.get("role") ?? undefined);
  const format = sp.get("format") === "jpg" ? "jpg" : "png";
  const w = Number(sp.get("w")) || 0;
  const width = w >= PREVIEW_MIN ? Math.floor(w) : undefined;

  const { year, entries } = await loadPosterEntries({ month, ind, role });
  if (!entries.length) return new Response("Belum ada MA closing di bulan/filter ini.", { status: 404 });
  const text = (k: string, fallback: string) => (sp.get(k) ?? "").trim().slice(0, MAX_TEXT) || fallback;
  const slots = await Promise.all(entries.slice(0, POSTER_SIZE).map(async (e, i) => ({
    name: text(`name${i + 1}`, e.name),
    office: text(`office${i + 1}`, e.office),
    photo: e.photo.path ? await downloadPhoto(e.photo.path) : null,
  })));

  const img = await renderPoster({ month: posterMonth(month, year), slots }, { format, width });
  const filename = `Top 10 MA ${BULAN[month - 1]} ${year}${ind ? ` ${ind}` : ""}.${format}`;
  const headers: Record<string, string> = { "Content-Type": format === "jpg" ? "image/jpeg" : "image/png", "Cache-Control": "private, no-store" };
  if (sp.get("download")) headers["Content-Disposition"] = `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
  return new Response(new Uint8Array(img), { headers });
}
