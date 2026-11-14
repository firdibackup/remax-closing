import "server-only";

import sharp from "sharp";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { findEmployeeByCode } from "@/lib/genius/client";
import { geniusPhotoUrls } from "@/lib/top-ma/format";

// Foto MA untuk poster (closing.agent_photos + Storage ma-photos, migrasi 0006).
// Foto Genius diunduh sekali lalu disimpan; upload manual HQ selalu menang. Genius yang tidak bisa dihubungi
// (502/timeout) tidak dicatat, jadi dicoba lagi di render berikutnya; foto yang memang tidak ada/404 dicatat di note.

const BUCKET = "ma-photos";
const MAX_SIDE = 1400; // kotak foto terbesar di poster 1120×1500
const FETCH_TIMEOUT_MS = 30_000;
const GENIUS_CONCURRENCY = 4;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
// Cutout: ≥ 15% piksel benar-benar transparan (foto berlatar penuh ≈ 0%, cutout setengah badan 40–65%).
const CUTOUT_MIN_TRANSPARENT = 0.15;
const ALPHA_CLEAR = 20;
const SAMPLE_SIDE = 200;
// Batas server action di next.config.ts 6 MB (termasuk isian form lain).
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type PhotoRow = { agent_id: string; source: "genius" | "manual"; path: string | null; transparent: boolean; genius_url: string | null; note: string | null; updated_at: string };
export type AgentRef = { id: string; employee_code: string };

const db = () => supabaseClosingAdmin();

async function isCutout(img: Buffer): Promise<boolean> {
  const meta = await sharp(img).metadata();
  if (!meta.hasAlpha) return false;
  const { data, info } = await sharp(img).ensureAlpha().extractChannel("alpha").resize(SAMPLE_SIDE, SAMPLE_SIDE, { fit: "inside" }).raw().toBuffer({ resolveWithObject: true });
  let clear = 0;
  for (let i = 0; i < data.length; i++) if (data[i] < ALPHA_CLEAR) clear++;
  return clear / (info.width * info.height) >= CUTOUT_MIN_TRANSPARENT;
}

// Semua foto disimpan sebagai PNG ≤ 1400 px. Cutout dipotong margin transparannya supaya kepala menempel di atas kotak
// (aturan template). Foto berlatar dibiarkan utuh.
export async function normalizePhoto(input: Buffer): Promise<{ png: Buffer; transparent: boolean }> {
  const base = await sharp(input, { failOn: "error" }).rotate().resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  const transparent = await isCutout(base);
  const png = transparent ? await sharp(base).trim({ threshold: 1 }).png().toBuffer() : base;
  return { png, transparent };
}

async function store(agentId: string, png: Buffer): Promise<string> {
  const path = `agents/${agentId}-${Date.now()}.png`;
  const { error } = await db().storage.from(BUCKET).upload(path, png, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`Gagal simpan foto ke Storage: ${error.message}`);
  return path;
}

async function removeOld(path: string | null | undefined) {
  if (path) await db().storage.from(BUCKET).remove([path]);
}

async function upsertRow(row: Omit<PhotoRow, "updated_at">, prevPath?: string | null) {
  const { error } = await db().from("agent_photos").upsert({ ...row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Gagal simpan data foto: ${error.message}`);
  if (prevPath && prevPath !== row.path) await removeOld(prevPath);
}

export async function loadPhotoRows(agentIds: string[]): Promise<Map<string, PhotoRow>> {
  if (!agentIds.length) return new Map();
  const { data, error } = await db().from("agent_photos").select("*").in("agent_id", agentIds);
  if (error) throw new Error(`Gagal baca foto MA: ${error.message}`);
  return new Map((data as PhotoRow[]).map((r) => [r.agent_id, r]));
}

export async function downloadPhoto(path: string): Promise<Buffer> {
  const { data, error } = await db().storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Gagal unduh foto ${path}: ${error?.message ?? "kosong"}`);
  return Buffer.from(await data.arrayBuffer());
}

type GeniusResult = { kind: "ok"; png: Buffer; transparent: boolean; url: string } | { kind: "missing"; note: string; url: string | null };

// Kesalahan jaringan/server Genius dilempar (tidak dicatat); foto yang memang tidak ada → kind "missing".
async function fetchFromGenius(employeeCode: string): Promise<GeniusResult> {
  const emp = await findEmployeeByCode(employeeCode);
  if (!emp) return { kind: "missing", note: "Agen tidak ditemukan di Genius", url: null };
  const url = emp.user?.profilePic ?? null;
  const tries = geniusPhotoUrls(url);
  if (!tries.length) return { kind: "missing", note: "Belum ada foto profil di Genius", url };
  let last = "";
  for (const u of tries) {
    const res = await fetch(u, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) { last = `HTTP ${res.status}`; continue; }
    try {
      const { png, transparent } = await normalizePhoto(Buffer.from(await res.arrayBuffer()));
      return { kind: "ok", png, transparent, url: url! };
    } catch {
      return { kind: "missing", note: "Berkas foto Genius bukan gambar yang bisa dibaca", url };
    }
  }
  return { kind: "missing", note: `Foto Genius tidak bisa diunduh (${last})`, url };
}

async function syncFromGenius(agent: AgentRef, prev: PhotoRow | undefined): Promise<void> {
  const r = await fetchFromGenius(agent.employee_code);
  if (r.kind === "ok") {
    const path = await store(agent.id, r.png);
    await upsertRow({ agent_id: agent.id, source: "genius", path, transparent: r.transparent, genius_url: r.url, note: null }, prev?.path);
  } else {
    await upsertRow({ agent_id: agent.id, source: "genius", path: null, transparent: false, genius_url: r.url, note: r.note }, prev?.path);
  }
}

// Agen yang belum punya catatan foto diambil dari Genius (paralel terbatas). Gagal jaringan → dilewati, dicoba lagi nanti.
// Mengembalikan pesan untuk agen yang gagal karena Genius tidak bisa dihubungi.
export async function ensurePhotos(agents: AgentRef[]): Promise<{ rows: Map<string, PhotoRow>; errors: string[] }> {
  let rows = await loadPhotoRows(agents.map((a) => a.id));
  const todo = agents.filter((a) => !rows.has(a.id) && a.employee_code);
  const errors: string[] = [];
  for (let i = 0; i < todo.length; i += GENIUS_CONCURRENCY) {
    const batch = todo.slice(i, i + GENIUS_CONCURRENCY);
    const out = await Promise.allSettled(batch.map((a) => syncFromGenius(a, undefined)));
    out.forEach((o, j) => { if (o.status === "rejected") errors.push(`${batch[j].employee_code}: ${o.reason instanceof Error ? o.reason.message : String(o.reason)}`); });
  }
  if (todo.length) rows = await loadPhotoRows(agents.map((a) => a.id));
  return { rows, errors };
}

// Ambil ulang dari Genius (mis. agen baru mengganti foto profil). Menggantikan foto yang ada hanya kalau foto Genius
// berhasil diunduh; kalau tidak ada, foto lama (termasuk upload manual) tetap dipakai dan alasannya dikembalikan.
export async function refreshFromGenius(agent: AgentRef): Promise<{ row: PhotoRow | undefined; missing: string | null }> {
  const prev = (await loadPhotoRows([agent.id])).get(agent.id);
  if (prev?.path) {
    const r = await fetchFromGenius(agent.employee_code);
    if (r.kind === "missing") return { row: prev, missing: r.note };
    const path = await store(agent.id, r.png);
    await upsertRow({ agent_id: agent.id, source: "genius", path, transparent: r.transparent, genius_url: r.url, note: null }, prev.path);
  } else {
    await syncFromGenius(agent, prev);
  }
  const row = (await loadPhotoRows([agent.id])).get(agent.id);
  return { row, missing: row?.path ? null : row?.note ?? "Foto Genius tidak ada." };
}

export async function saveManualPhoto(agentId: string, file: Buffer): Promise<{ transparent: boolean }> {
  const prev = (await loadPhotoRows([agentId])).get(agentId);
  const { png, transparent } = await normalizePhoto(file);
  const path = await store(agentId, png);
  await upsertRow({ agent_id: agentId, source: "manual", path, transparent, genius_url: prev?.genius_url ?? null, note: null }, prev?.path);
  return { transparent };
}
