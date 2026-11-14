"use server";

import { refreshAll } from "@/lib/closing/cache";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { audit, fail, ok, str, type ActionResult } from "@/lib/closing/audit";
import { calcAmounts } from "@/lib/closing/calc";
import { isWritable, type PeriodLike } from "@/lib/closing/periods";

// Pindah kantor agen (PLAN §7a.3): penugasan lama ditutup sehari sebelum tanggal efektif,
// penugasan baru dibuka mulai tanggal efektif. Tidak ada tumpang tindih (dijaga constraint di DB).
// Transaksi sebelum tanggal efektif tetap di kantor lama lewat snapshot commission_lines.cabang_id.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type MoveLine = { id: string; komisi_gross: number; periods: PeriodLike | null };

// Transfer mundur: baris agen di kantor lama bertanggal ≥ tanggal efektif. Yang di periode terbuka dipindah ke
// kantor baru dan dihitung ulang dengan tarifnya; yang di periode terkunci tidak diubah.
async function moveOpenLines(agentId: string, fromOffice: string, toOffice: string, effective: string): Promise<{ moved: number; locked: number } | string> {
  const db = supabaseClosingAdmin();
  const [{ data: dest, error: dErr }, { data, error }] = await Promise.all([
    db.from("offices").select("royalty_rate,ssdf_rate").eq("id", toOffice).single(),
    db.from("commission_lines").select("id,komisi_gross,periods!period_id(year,month,status,cutoff_at)")
      .eq("agent_id", agentId).eq("cabang_id", fromOffice).gte("tanggal_transaksi", effective).is("batal_at", null).limit(2000),
  ]);
  if (dErr || !dest) return `Gagal baca kantor tujuan: ${dErr?.message ?? "tidak ditemukan"}`;
  if (error) return `Gagal baca transaksi agen: ${error.message}`;
  const rows = (data ?? []) as unknown as MoveLine[];
  const movable = rows.filter((l) => l.periods && isWritable(l.periods));
  for (const l of movable) {
    const rates = { royalty_rate: Number(dest.royalty_rate), ssdf_rate: Number(dest.ssdf_rate) };
    const { error: uErr } = await db.from("commission_lines")
      .update({ cabang_id: toOffice, ...rates, ...calcAmounts(Number(l.komisi_gross), rates.royalty_rate, rates.ssdf_rate) }).eq("id", l.id);
    if (uErr) return `Gagal memindah transaksi: ${uErr.message}`;
  }
  return { moved: movable.length, locked: rows.length - movable.length };
}

export async function transferAgent(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const agentId = str(fd, "agent_id");
  const officeId = str(fd, "office_id");
  const effective = str(fd, "effective");
  if (!UUID.test(agentId) || !UUID.test(officeId)) return fail("Pilih agen dan kantor tujuan.");
  if (!ISO.test(effective)) return fail("Tanggal efektif tidak valid.");

  const db = supabaseClosingAdmin();
  const { data: current, error: curErr } = await db.from("agent_assignments")
    .select("id,office_id,start_date,end_date").eq("agent_id", agentId).is("end_date", null)
    .order("start_date", { ascending: false }).limit(1).maybeSingle();
  if (curErr) return fail(curErr.message);
  if (current?.office_id === officeId) return fail("Agen sudah berada di kantor itu.");
  if (current && effective <= current.start_date) return fail(`Tanggal efektif harus setelah ${current.start_date}.`);

  if (current) {
    const { error: closeErr } = await db.from("agent_assignments").update({ end_date: dayBefore(effective) }).eq("id", current.id);
    if (closeErr) return fail(closeErr.message);
  }
  const { error: insErr } = await db.from("agent_assignments").insert({
    agent_id: agentId, office_id: officeId, start_date: effective, alasan: "transfer", created_by: "superadmin",
  });
  if (insErr) return fail(insErr.message);

  const move = current && fd.get("move_open") === "on" ? await moveOpenLines(agentId, current.office_id, officeId, effective) : null;
  await audit("Transfer agen", "agent_assignments", agentId, { dari: current?.office_id ?? null, ke: officeId, efektif: effective, ...(move && typeof move !== "string" ? move : {}) });
  refreshAll();
  if (typeof move === "string") return fail(`Agen sudah dipindah, tetapi ${move}`);
  const moved = move?.moved ? ` ${move.moved} transaksi periode terbuka ikut dipindah & dihitung ulang.` : "";
  const locked = move?.locked ? ` ${move.locked} transaksi di periode terkunci tidak diubah.` : "";
  return ok(`Agen dipindahkan mulai ${effective}. Transaksi sebelum tanggal itu tetap di kantor lama.${moved}${locked}`);
}

// Batalkan pindah terakhir: hanya bila belum ada transaksi sistem (Genius/Excel) di kantor baru.
export async function undoTransfer(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const agentId = str(fd, "agent_id");
  if (!UUID.test(agentId)) return fail("Agen tidak valid.");
  const db = supabaseClosingAdmin();
  const { data, error } = await db.from("agent_assignments").select("id,office_id,start_date,alasan").eq("agent_id", agentId).order("start_date");
  if (error) return fail(error.message);
  const list = data ?? [];
  const last = list.at(-1), prev = list.at(-2);
  if (!last || !prev || last.alasan !== "transfer") return fail("Tidak ada pindah kantor yang bisa dibatalkan.");
  const { count, error: cErr } = await db.from("commission_lines").select("id", { count: "exact", head: true })
    .eq("agent_id", agentId).eq("cabang_id", last.office_id).neq("source", "import").is("batal_at", null);
  if (cErr) return fail(cErr.message);
  if (count) return fail(`Sudah ada ${count} transaksi di kantor baru. Pindahkan lagi lewat Pindah kantor, bukan dibatalkan.`);
  const { error: dErr } = await db.from("agent_assignments").delete().eq("id", last.id);
  if (dErr) return fail(dErr.message);
  const { error: uErr } = await db.from("agent_assignments").update({ end_date: null }).eq("id", prev.id);
  if (uErr) return fail(`Penugasan baru dihapus, tetapi penugasan lama gagal dibuka: ${uErr.message}`);
  await audit("batal_transfer", "agent_assignments", agentId, { batal_ke: last.office_id, kembali_ke: prev.office_id });
  refreshAll();
  return ok("Pindah kantor dibatalkan. Agen kembali ke kantor sebelumnya.");
}
