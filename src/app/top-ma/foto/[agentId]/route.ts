import { downloadPhoto, loadPhotoRows } from "@/lib/top-ma/photos";

// Foto MA tersimpan (PNG dari Storage privat ma-photos) untuk thumbnail di halaman poster. 404 = belum ada foto.
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(_req: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await params;
  if (!UUID.test(agentId)) return new Response("ID agen tidak valid.", { status: 400 });
  const row = (await loadPhotoRows([agentId])).get(agentId);
  if (!row?.path) return new Response("Foto belum ada.", { status: 404 });
  const png = await downloadPhoto(row.path);
  return new Response(new Uint8Array(png), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=60" } });
}
