"use server";

import { refreshAll } from "@/lib/closing/cache";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit, fail, ok, str, type ActionResult } from "@/lib/closing/audit";
import { isInputOpen, parseWibLocal, type PeriodLike } from "@/lib/closing/periods";
import { KATEGORI_RATES } from "@/lib/closing/calc";
import { normalizePhone } from "@/lib/closing/phone";

const UUID = /^[0-9a-f-]{36}$/i;
const done = (msg: string) => { refreshAll(); return ok(msg); };

// Rekonsiliasi: status cek per kantor per periode (closing.recon_status).
const RECON = ["Done", "Selisih", "Belum kirim", "Nihil"] as const;
export async function setRecon(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const period_id = str(fd, "period_id"), cabang_id = str(fd, "cabang_id"), status = str(fd, "status"), catatan = str(fd, "catatan") || null;
  if (!UUID.test(period_id) || !UUID.test(cabang_id)) return fail("Periode/kantor tidak valid.");
  const db = supabaseClosingAdmin();
  if (!status) {
    const { error } = await db.from("recon_status").delete().eq("period_id", period_id).eq("cabang_id", cabang_id);
    if (error) return fail(`Gagal menyimpan: ${error.message}`);
  } else {
    if (!(RECON as readonly string[]).includes(status)) return fail("Status tidak dikenal.");
    const { error } = await db.from("recon_status").upsert({ period_id, cabang_id, status, catatan, checked_by: "superadmin", checked_at: new Date().toISOString() });
    if (error) return fail(`Gagal menyimpan: ${error.message}`);
  }
  await audit("rekon_status", "recon_status", `${period_id}:${cabang_id}`, { status: status || null, catatan });
  return done("Status rekonsiliasi disimpan.");
}

// Beranda: kantor tanpa closing di periode ini ditandai Nihil (recon_status), hanya selama periode terbuka.
export async function markNihil(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const period_id = str(fd, "period_id"), cabang_id = str(fd, "cabang_id");
  if (!UUID.test(period_id) || !UUID.test(cabang_id)) return fail("Periode/kantor tidak valid.");
  const db = supabaseClosingAdmin();
  const { data: p, error } = await db.from("periods").select("year,month,status,cutoff_at").eq("id", period_id).maybeSingle();
  if (error) return fail(`Gagal baca periode: ${error.message}`);
  if (!p || !isInputOpen(p as PeriodLike)) return fail("Periode terkunci, lewat cut-off, atau belum mulai.");
  const { count, error: cErr } = await db.from("commission_lines").select("id", { count: "exact", head: true }).eq("period_id", period_id).eq("cabang_id", cabang_id).is("batal_at", null);
  if (cErr) return fail(`Gagal cek baris kantor: ${cErr.message}`);
  if (count) return fail("Kantor ini sudah punya baris di periode ini, jadi tidak bisa ditandai Nihil.");
  const catatan = str(fd, "catatan") || null;
  const { error: upErr } = await db.from("recon_status").upsert({ period_id, cabang_id, status: "Nihil", catatan, checked_by: "superadmin", checked_at: new Date().toISOString() });
  if (upErr) return fail(`Gagal menyimpan: ${upErr.message}`);
  await audit("tandai_nihil", "recon_status", `${period_id}:${cabang_id}`, { catatan });
  return done("Kantor ditandai Nihil.");
}

// Periode: kunci / buka kunci manual oleh Superadmin (PLAN §6). Buka kunci wajib memberi batas baru
// (cutoff_at); setelah lewat, periode terkunci otomatis lagi.
export async function setPeriodStatus(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id"), status = str(fd, "status");
  if (!UUID.test(id) || !["open", "locked"].includes(status)) return fail("Permintaan tidak valid.");
  const locked = status === "locked";
  const until = locked ? null : parseWibLocal(str(fd, "until"));
  if (!locked && (!until || Date.parse(until) <= Date.now())) return fail("Isi batas buka kunci (tanggal & jam WIB) yang belum lewat.");
  const update = locked
    ? { status, locked_at: new Date().toISOString(), locked_by: "superadmin" }
    : { status, locked_at: null, locked_by: null, cutoff_at: until };
  const { error } = await supabaseClosingAdmin().from("periods").update(update).eq("id", id);
  if (error) return fail(`Gagal menyimpan: ${error.message}`);
  await audit(locked ? "kunci_periode" : "buka_periode", "periods", id, { reason: str(fd, "reason") || null, until });
  return done(locked ? "Periode dikunci." : "Periode dibuka sampai batas yang dipilih, lalu terkunci otomatis lagi.");
}

// Master kantor & agen (tidak pernah otomatis; admin mengisi lewat form ini).
const RATES: Record<string, readonly [number, number]> = KATEGORI_RATES;
export async function saveOffice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id"), kategori = str(fd, "kategori");
  const row = { office_code: str(fd, "office_code").toUpperCase(), induk_name: str(fd, "induk_name").toUpperCase(), cabang_name: str(fd, "cabang_name"), kategori, report_channel: str(fd, "report_channel") || "GENIUS", status: str(fd, "status") || "aktif", alamat: str(fd, "alamat") || null };
  if (!row.office_code || !row.induk_name || !row.cabang_name) return fail("Office ID, induk, dan nama cabang wajib diisi.");
  if (!RATES[kategori]) return fail("Pilih kategori tarif 3,5% atau 9%. Tarif tidak ditebak sistem.");
  const full = { ...row, royalty_rate: RATES[kategori][0], ssdf_rate: RATES[kategori][1], updated_at: new Date().toISOString() };
  const db = supabaseClosingAdmin();
  const res = id ? await db.from("offices").update(full).eq("id", id).select("id").single() : await db.from("offices").insert(full).select("id").single();
  if (res.error) return fail(res.error.code === "23505" ? "Nama cabang sudah ada." : `Gagal menyimpan: ${res.error.message}`);
  await audit(id ? "ubah_kantor" : "tambah_kantor", "offices", res.data.id as string, row);
  return done(id ? "Kantor disimpan. Kategori baru berlaku untuk input berikutnya." : "Kantor ditambahkan.");
}

export async function saveAgent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  const row = { employee_code: str(fd, "employee_code").toUpperCase(), name: str(fd, "name"), full_name: str(fd, "full_name") || null, sheet_name: str(fd, "sheet_name") || null, role: str(fd, "role") || "agent_property", status: str(fd, "status") || "aktif" };
  if (!row.employee_code || !row.name) return fail("Agent ID dan nama wajib diisi.");
  const db = supabaseClosingAdmin();
  const res = id ? await db.from("agents").update({ ...row, updated_at: new Date().toISOString() }).eq("id", id).select("id").single() : await db.from("agents").insert(row).select("id").single();
  if (res.error) return fail(res.error.code === "23505" ? "Agent ID sudah dipakai." : `Gagal menyimpan: ${res.error.message}`);
  const agentId = res.data.id as string;
  if (!id) {
    const office_id = str(fd, "office_id"), start_date = str(fd, "start_date");
    if (!UUID.test(office_id) || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) return fail("Agen tersimpan, tetapi kantor/tanggal bergabung tidak valid. Lengkapi lewat Ubah.");
    const { error } = await db.from("agent_assignments").insert({ agent_id: agentId, office_id, start_date, alasan: "awal", created_by: "superadmin" });
    if (error) return fail(`Agen tersimpan, tetapi penugasan kantor gagal: ${error.message}`);
  }
  await audit(id ? "ubah_agen" : "tambah_agen", "agents", agentId, row);
  return done(id ? "Agen disimpan." : "Agen ditambahkan.");
}

// Hapus kantor: hanya bila belum punya transaksi dan agen (termasuk riwayat). Selain itu cukup ditandai Tutup
// supaya laporan lama tetap utuh.
export async function deleteOffice(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!UUID.test(id)) return fail("Kantor tidak valid.");
  const db = supabaseClosingAdmin();
  const [lines, assigns] = await Promise.all([
    db.from("commission_lines").select("id", { count: "exact", head: true }).eq("cabang_id", id),
    db.from("agent_assignments").select("id", { count: "exact", head: true }).eq("office_id", id),
  ]);
  if (lines.error || assigns.error) return fail(`Gagal cek pemakaian kantor: ${(lines.error ?? assigns.error)?.message}`);
  if (lines.count || assigns.count) {
    const { error } = await db.from("offices").update({ status: "tutup", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return fail(`Gagal menyimpan: ${error.message}`);
    await audit("tutup_kantor", "offices", id, { transaksi: lines.count ?? 0, agen: assigns.count ?? 0 });
    return done(`Kantor punya ${lines.count ?? 0} transaksi dan ${assigns.count ?? 0} riwayat agen, jadi ditandai Tutup.`);
  }
  const { data, error } = await db.from("offices").delete().eq("id", id).select("cabang_name").single();
  if (error) return fail(error.code === "23503" ? "Kantor masih dipakai (status rekon/impor lama). Tandai Tutup lewat Ubah." : `Gagal menghapus: ${error.message}`);
  await audit("hapus_kantor", "offices", id, { cabang_name: data.cabang_name });
  return done("Kantor dihapus.");
}

// Hapus agen: hanya bila belum punya transaksi. Selain itu status menjadi Resign supaya laporan & Top MA tetap utuh.
export async function deleteAgent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!UUID.test(id)) return fail("Agen tidak valid.");
  const db = supabaseClosingAdmin();
  const { count, error: cErr } = await db.from("commission_lines").select("id", { count: "exact", head: true }).eq("agent_id", id);
  if (cErr) return fail(`Gagal cek transaksi agen: ${cErr.message}`);
  if (count) {
    const { error } = await db.from("agents").update({ status: "resign", updated_at: new Date().toISOString() }).eq("id", id);
    if (error) return fail(`Gagal menyimpan: ${error.message}`);
    await audit("resign_agen", "agents", id, { transaksi: count });
    return done(`Agen punya ${count} transaksi, jadi status diubah menjadi Resign.`);
  }
  const { data, error } = await db.from("agents").delete().eq("id", id).select("name,employee_code").single();
  if (error) return fail(error.code === "23503" ? "Agen masih dipakai sebagai kontak kantor. Hapus kontaknya dulu atau ubah status ke Resign." : `Gagal menghapus: ${error.message}`);
  await audit("hapus_agen", "agents", id, data);
  return done("Agen dihapus.");
}

// Kontak kantor (PLAN §7a.1): Admin/BO/FO/lainnya; satu kontak utama per kantor; nomor disimpan +62….
const JENIS = ["admin", "bo", "franchise_owner", "lainnya"] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export async function saveContact(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id"), office_id = str(fd, "office_id"), jenis = str(fd, "jenis"), rawPhone = str(fd, "phone");
  if (!UUID.test(office_id) || (id && !UUID.test(id))) return fail("Kantor/kontak tidak valid.");
  if (!(JENIS as readonly string[]).includes(jenis)) return fail("Jenis kontak tidak dikenal.");
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  if (rawPhone && !phone) return fail("Nomor telepon tidak valid (9–15 digit, mis. 0812-3456-7890).");
  const email = str(fd, "email") || null;
  if (email && !EMAIL.test(email)) return fail("Email tidak valid.");
  const row = { office_id, jenis, nama: str(fd, "nama") || null, phone, email, is_primary: fd.get("is_primary") === "on", catatan: str(fd, "catatan") || null };
  if (!row.nama && !row.phone && !row.email) return fail("Isi minimal nama, telepon, atau email.");
  const db = supabaseClosingAdmin();
  if (row.is_primary) {
    const { error } = await db.from("office_contacts").update({ is_primary: false }).eq("office_id", office_id);
    if (error) return fail(`Gagal menyimpan: ${error.message}`);
  }
  const res = id ? await db.from("office_contacts").update(row).eq("id", id).select("id").single() : await db.from("office_contacts").insert(row).select("id").single();
  if (res.error) return fail(`Gagal menyimpan: ${res.error.message}`);
  await audit(id ? "ubah_kontak" : "tambah_kontak", "office_contacts", res.data.id as string, row);
  return done("Kontak disimpan.");
}

export async function deleteContact(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  if (!UUID.test(id)) return fail("Kontak tidak valid.");
  const { data, error } = await supabaseClosingAdmin().from("office_contacts").delete().eq("id", id).select("office_id,jenis,nama,phone").single();
  if (error) return fail(`Gagal menghapus: ${error.message}`);
  await audit("hapus_kontak", "office_contacts", id, data);
  return done("Kontak dihapus.");
}
