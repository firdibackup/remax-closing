"use server";

import { revalidatePath } from "next/cache";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit, fail, ok, str, type ActionResult } from "@/lib/closing/audit";
import { MAX_UPLOAD_BYTES, refreshFromGenius, saveManualPhoto } from "@/lib/top-ma/photos";

// Foto MA untuk poster Top 10: upload manual (PNG cutout) atau ambil ulang dari Genius.
const UUID = /^[0-9a-f-]{36}$/i;
const IMAGE_TYPES = ["image/png", "image/jpeg"];

async function agentOf(id: string) {
  const { data, error } = await supabaseClosingAdmin().from("agents").select("id,employee_code,name").eq("id", id).maybeSingle();
  if (error) throw new Error(`Gagal baca agen: ${error.message}`);
  return data as { id: string; employee_code: string; name: string } | null;
}

export async function uploadMaPhoto(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const agentId = str(fd, "agent_id");
  const file = fd.get("photo");
  if (!UUID.test(agentId)) return fail("Agen tidak valid.");
  if (!(file instanceof File) || !file.size) return fail("Pilih file foto dulu.");
  if (!IMAGE_TYPES.includes(file.type)) return fail("Foto harus PNG atau JPG (PNG cutout transparan paling bagus).");
  if (file.size > MAX_UPLOAD_BYTES) return fail("Foto maksimal 5 MB.");
  const agent = await agentOf(agentId);
  if (!agent) return fail("Agen tidak ditemukan di master.");
  let transparent: boolean;
  try {
    ({ transparent } = await saveManualPhoto(agentId, Buffer.from(await file.arrayBuffer())));
  } catch (e) {
    return fail(e instanceof Error && /Storage|data foto/.test(e.message) ? e.message : "File bukan gambar yang bisa dibaca.");
  }
  await audit("foto_ma_upload", "agent_photos", agentId, { file: file.name, transparent });
  revalidatePath("/top-ma/poster");
  return ok(transparent ? `Foto ${agent.name} disimpan.` : `Foto ${agent.name} disimpan, tapi latarnya belum transparan. Upload PNG cutout supaya rapi di poster.`);
}

export async function refreshMaPhoto(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const agentId = str(fd, "agent_id");
  if (!UUID.test(agentId)) return fail("Agen tidak valid.");
  const agent = await agentOf(agentId);
  if (!agent) return fail("Agen tidak ditemukan di master.");
  let res;
  try {
    res = await refreshFromGenius(agent);
  } catch (e) {
    return fail(`Genius tidak bisa dihubungi, coba lagi nanti. (${e instanceof Error ? e.message : String(e)})`);
  }
  const { row, missing } = res;
  if (missing && row?.path) return fail(`${missing}. Foto yang sekarang tetap dipakai.`);
  await audit("foto_ma_genius", "agent_photos", agentId, { path: row?.path ?? null, note: row?.note ?? null });
  revalidatePath("/top-ma/poster");
  if (!row?.path) return fail(missing ?? "Foto Genius tidak ada.");
  return ok(row.transparent ? `Foto ${agent.name} diambil dari Genius.` : `Foto ${agent.name} diambil dari Genius, tapi latarnya belum transparan.`);
}
