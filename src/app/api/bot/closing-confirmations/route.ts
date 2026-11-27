import { bad, isoOrNull, json, officeById, periodByKey, readBody, strings, text, unauthorized, type OfficeRec, type PeriodRec } from "@/lib/bot/api";
import { isOfficeContact } from "@/lib/bot/schedule";
import { audit } from "@/lib/closing/audit";
import { refreshAll } from "@/lib/closing/cache";
import { parseCodes } from "@/lib/closing/codes";
import { loadContacts } from "@/lib/closing/contacts";
import { isInputOpen } from "@/lib/closing/periods";
import { normalizePhone } from "@/lib/closing/phone";
import { freshLines, isReady } from "@/lib/genius/pull";
import { previewCodes, storeClosings } from "@/lib/genius/save";
import { supabaseClosingAdmin } from "@/lib/supabase/client";

// POST /api/bot/closing-confirmations: hasil akhir balasan admin kantor (sudah diolah Hermes).
// kind = closings → diproses seperti Input Closing (dobel invoice dilewati, agen/kantor belum di master ditahan),
//        nihil → status rekon Nihil, excel_uploaded → dicatat saja (HQ mengunggah file dari Drive).
// message_id sama → hasil pertama dikembalikan lagi, tidak diproses dua kali.
export const dynamic = "force-dynamic";

const KINDS = ["closings", "nihil", "excel_uploaded"] as const;
type Kind = (typeof KINDS)[number];
type Held = { closing_code: string; reason: string };
type Result = {
  status: "saved" | "partial" | "held" | "rejected" | "noted";
  saved: string[]; already_reported: string[]; held: Held[]; errors: Held[]; message: string; lines?: number;
};

const empty = { saved: [], already_reported: [], held: [], errors: [] };
const reject = (message: string): Result => ({ status: "rejected", ...empty, message });

async function processClosings(codes: string[], office: OfficeRec, period: PeriodRec): Promise<Result> {
  if (!codes.length) return reject("Tidak ada Closing ID yang dikonfirmasi.");
  const db = supabaseClosingAdmin();
  const { data: sameCode, error } = await db.from("offices").select("id").eq("office_code", office.office_code);
  if (error) throw new Error(error.message);
  const ownIds = new Set([office.id, ...(sameCode ?? []).map((o) => o.id as string)]);

  const previews = await previewCodes(codes, period.id);
  const held: Held[] = [], errors: Held[] = [], already: string[] = [];
  const ready = [];
  for (const p of previews) {
    if (p.error) errors.push({ closing_code: p.closingCode, reason: "tidak ditemukan di Genius" });
    else if (p.holds.length) held.push({ closing_code: p.closingCode, reason: p.holds.map((h) => `${h.kind} ${[h.code, h.name].filter(Boolean).join(" ")} belum di master`).join("; ") });
    else if (!p.lines.some((l) => ownIds.has(l.cabang_id))) errors.push({ closing_code: p.closingCode, reason: "bukan closing kantor ini" });
    else if (!freshLines(p).length) already.push(p.closingCode);
    else if (isReady(p)) ready.push(p);
    else errors.push({ closing_code: p.closingCode, reason: "tidak ada baris yang bisa disimpan" });
  }
  const stored = await storeClosings(ready, period.id);
  const saved = stored.codes;
  const notSaved = held.length + errors.length;
  const status: Result["status"] = saved.length || already.length
    ? (notSaved ? "partial" : "saved")
    : held.length ? "held" : "rejected";
  const parts = [
    saved.length ? `${saved.length} closing tersimpan` : "",
    already.length ? `${already.length} sudah tercatat sebelumnya` : "",
    held.length ? `${held.length} ditahan (data agen/kantor belum lengkap, HQ akan melengkapi)` : "",
    errors.length ? `${errors.length} tidak bisa diproses` : "",
  ].filter(Boolean);
  return { status, saved, already_reported: already, held, errors, lines: stored.lines, message: `${parts.join(", ")}.` };
}

async function processNihil(office: OfficeRec, period: PeriodRec): Promise<Result> {
  const db = supabaseClosingAdmin();
  const { count, error } = await db.from("commission_lines").select("id", { count: "exact", head: true }).eq("period_id", period.id).eq("cabang_id", office.id).is("batal_at", null);
  if (error) throw new Error(error.message);
  if (count) return reject("Kantor ini sudah punya closing tercatat di periode ini, jadi tidak bisa ditandai Nihil. HQ akan mengecek.");
  const { error: upErr } = await db.from("recon_status").upsert({ period_id: period.id, cabang_id: office.id, status: "Nihil", catatan: "Konfirmasi WA bot", checked_by: "bot WA", checked_at: new Date().toISOString() });
  if (upErr) throw new Error(upErr.message);
  return { status: "saved", ...empty, message: "Tercatat: tidak ada closing (Nihil) bulan ini." };
}

export async function POST(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const b = await readBody(req);
  if (!b) return bad("Body harus JSON object.");
  const message_id = text(b.message_id);
  const kind = text(b.kind || (b.nihil === true ? "nihil" : "closings")) as Kind;
  if (!message_id) return bad("message_id wajib diisi.");
  if (!KINDS.includes(kind)) return bad('kind harus "closings", "nihil", atau "excel_uploaded".');
  const [office, period] = await Promise.all([officeById(text(b.cabang_id)), periodByKey(text(b.period))]);
  if (!office) return bad("cabang_id tidak dikenal.");

  const codes = parseCodes(strings(b.confirmed_closing_codes ?? b.confirmed_closing_ids).join("\n"));
  const db = supabaseClosingAdmin();
  const reply_from = text(b.reply_from);
  const claim = await db.from("bot_confirmations").insert({
    period_id: period?.id ?? null, cabang_id: office.id, kind, reply_from: normalizePhone(reply_from) ?? (reply_from || null),
    confirmed_codes: codes, raw_reply: text(b.raw_reply) || null, message_id, replied_at: isoOrNull(b.replied_at), status: "processing",
  }).select("id").single();
  if (claim.error?.code === "23505") {
    const { data: prev } = await db.from("bot_confirmations").select("id,status,result").eq("message_id", message_id).single();
    if (prev?.status === "processing") return json({ status: "processing", message: "Balasan ini sedang diproses." }, 409);
    return json({ ...(prev?.result ?? {}), confirmation_id: prev?.id, duplicate: true });
  }
  if (claim.error) throw new Error(`Gagal mencatat balasan: ${claim.error.message}`);
  const id = claim.data.id as string;

  let result: Result;
  try {
    const contacts = (await loadContacts([office.id])).get(office.id) ?? [];
    if (!period) result = reject("Periode tidak dikenal.");
    else if (!isOfficeContact(contacts, reply_from)) result = reject("Nomor pengirim tidak terdaftar sebagai kontak kantor ini. Hubungi HQ.");
    else if (!isInputOpen(period)) result = reject("Periode laporan sudah ditutup (lewat cut-off). Hubungi HQ.");
    else if (kind === "nihil") result = await processNihil(office, period);
    else if (kind === "excel_uploaded") result = { status: "noted", ...empty, message: "Terima kasih, HQ akan mengecek file di Google Drive." };
    else result = await processClosings(codes, office, period);
  } catch (e) {
    // Gagal di tengah: hapus klaim supaya Hermes bisa mengulang. Closing yang sempat tersimpan terbaca "sudah tercatat".
    await db.from("bot_confirmations").delete().eq("id", id);
    throw e;
  }

  const { error: upErr } = await db.from("bot_confirmations").update({ status: result.status, result }).eq("id", id);
  if (upErr) throw new Error(`Gagal menyimpan hasil: ${upErr.message}`);
  await audit("bot_konfirmasi", "bot_confirmations", id, {
    kantor: office.cabang_name, periode: text(b.period), jenis: kind, status: result.status,
    tersimpan: result.saved.length, ditahan: result.held.length, pesan: result.message,
  }, "bot WA");
  refreshAll();
  return json({ ...result, confirmation_id: id, duplicate: false });
}
