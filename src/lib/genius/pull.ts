import "server-only";

import { findClosingByCode } from "@/lib/genius/client";
import type { GeniusClosing, GeniusClosingPerson } from "@/lib/genius/types";
import { calcAmounts } from "@/lib/closing/calc";
import { agentGroups } from "@/lib/genius/sides";
import { supabaseClosingAdmin } from "@/lib/supabase/client";

// Pratinjau Input Closing (PLAN §3.4, §3.5a, §5). Tidak menulis apa pun ke database.
// Aturan: sisi INTERNAL masuk GC kantor sendiri; sisi EXTERNAL tidak masuk GC (hanya teks co-broke).
// Satu agen/kantor belum di master → seluruh closing ditahan (PLAN §7a.5).

// officeId: kantor agen menurut Genius (kalau ada di master), untuk mengisi awal form "Tambahkan ke master".
export type Hold = { kind: "agen" | "kantor"; code: string; name: string; closingCode: string; officeId?: string | null };

export type NewLine = {
  cabang_id: string;
  cabang_name: string; // hanya untuk pratinjau, tidak disimpan
  closing_code: string;
  invoice_number: string;
  tanggal_transaksi: string;
  bayar_via: string;
  res_comm: string;
  solo_cobroke: string;
  psr: string;
  lsl: string;
  ma_name: string;
  agent_id: string;
  nilai_transaksi: number;
  alamat: string;
  kantor_cobroke: string | null;
  ma_cobroke: string | null;
  komisi_gross: number;
  royalty_rate: number;
  ssdf_rate: number;
  royalti: number;
  ppn_royalti: number;
  pph_royalti: number;
  total_royalti: number;
  ssdf: number;
  ppn_ssdf: number;
  pph_ssdf: number;
  total_ssdf: number;
  ke_rmi: number;
  net_komisi: number;
  original: GeniusFigures | null;
};

// Angka pembanding rekonsiliasi (PLAN §5): officeFees.realValue Genius × prorata invoice, sebelum pajak.
export type GeniusFigures = { genius_royalti: number; genius_ssdf: number };

export type ClosingPreview = {
  closingCode: string;
  error: string | null;
  closingId: string | null;
  holds: Hold[];
  lines: NewLine[];
  invoices: { number: string; amount: number; phase: number | null; totalPhase: number | null; percentage: number | null }[];
  cobroke: boolean;
  warnings: string[];
  reported: string[]; // invoice yang sudah pernah dilaporkan, diisi previewClosings; dilewati saat simpan
};

export const freshLines = (p: ClosingPreview) => p.lines.filter((l) => !p.reported.includes(l.invoice_number));
export const isReady = (p: ClosingPreview) => !p.error && p.holds.length === 0 && freshLines(p).length > 0;

type Agent = { id: string; name: string; employee_code: string };
export type Office = { id: string; office_code: string; cabang_name: string; induk_name: string; royalty_rate: number; ssdf_rate: number };
type Assignment = { agent_id: string; office_id: string; start_date: string; end_date: string | null };

export type Context = {
  agentsByCode: Map<string, Agent>;
  officesById: Map<string, Office>;
  officesByCode: Map<string, Office[]>;
  assignments: Map<string, Assignment[]>;
};

export async function loadContext(): Promise<Context> {
  const db = supabaseClosingAdmin();
  const [agents, offices, assignments] = await Promise.all([
    db.from("agents").select("id,name,employee_code").limit(5000),
    db.from("offices").select("id,office_code,cabang_name,induk_name,royalty_rate,ssdf_rate").limit(1000),
    db.from("agent_assignments").select("agent_id,office_id,start_date,end_date").limit(5000),
  ]);
  for (const r of [agents, offices, assignments]) if (r.error) throw new Error(r.error.message);

  const officesById = new Map<string, Office>();
  const officesByCode = new Map<string, Office[]>();
  for (const o of (offices.data ?? []) as Office[]) {
    officesById.set(o.id, o);
    officesByCode.set(o.office_code, [...(officesByCode.get(o.office_code) ?? []), o]);
  }
  const agentsByCode = new Map<string, Agent>();
  for (const a of (agents.data ?? []) as Agent[]) agentsByCode.set(a.employee_code, a);
  const byAgent = new Map<string, Assignment[]>();
  for (const a of (assignments.data ?? []) as Assignment[]) byAgent.set(a.agent_id, [...(byAgent.get(a.agent_id) ?? []), a]);
  return { agentsByCode, officesById, officesByCode, assignments: byAgent };
}

// Kantor agen pada tanggal closing (PLAN §7a.3). Null kalau tidak ada penugasan yang berlaku.
function officeAt(ctx: Context, agentId: string, iso: string): Office | null {
  const a = (ctx.assignments.get(agentId) ?? []).find((x) => x.start_date <= iso && (!x.end_date || x.end_date >= iso));
  return a ? ctx.officesById.get(a.office_id) ?? null : null;
}

const num = (v: number | string | null | undefined) => Number(v ?? 0) || 0;

type Side = { side: "listing" | "selling" | "co_listing" | "co_selling"; person: GeniusClosingPerson };
type Resolved = { side: Side; office: Office | null; agent: Agent | null; hold: Hold | null };

function sidesOf(c: GeniusClosing): Side[] {
  const d = c.closingData;
  const out: Side[] = [];
  if (d?.listingPerson) out.push({ side: "listing", person: d.listingPerson });
  if (d?.sellingPerson) out.push({ side: "selling", person: d.sellingPerson });
  for (const p of d?.coListingPersons ?? []) out.push({ side: "co_listing", person: p });
  for (const p of d?.coSellingPersons ?? []) out.push({ side: "co_selling", person: p });
  return out;
}

function bayarVia(c: GeniusClosing): string {
  if (c.paymentType === "KPR") {
    const bank = (c.bankKPRName ?? "").replace(/^bank\s*/i, "").trim().toUpperCase();
    return bank ? `KPR/KTA ${bank}` : "KPR/KTA";
  }
  return "TUNAI/TRANSFER";
}

function psrOf(c: GeniusClosing): string {
  const meta = c.listingMetadata;
  if (meta?.sellOrRent === "rent") return "R";
  return meta?.listingType === "primary" ? "P" : "S";
}

const RATE_EPSILON = 1e-6;
const PERCENT_FORM_MIN = 0.1;
// ponytail: tarif Genius bisa tertulis 0,005 atau 0,5 (persen); angka ≥ 0,1 dianggap persen. Berlaku selama tarif < 10%.
const asFraction = (v: number) => (v >= PERCENT_FORM_MIN ? v / 100 : v);
const pct = (v: number) => `${(v * 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
const feeOf = (p: GeniusClosingPerson, rx: RegExp) => p.officeFees?.find((f) => rx.test(f.name));
const FEES = [[/royal/i, "Royalti", "royalty_rate"], [/ssdf/i, "SSDF", "ssdf_rate"]] as const;

// Tarif Genius beda dari kategori kantor → peringatan; yang dipakai tetap tarif kantor (PLAN §5).
function rateWarnings(r: Resolved): string[] {
  const office = r.office;
  if (!office) return [];
  return FEES.flatMap(([rx, label, key]) => {
    const fee = feeOf(r.side.person, rx);
    if (!fee) return [];
    const genius = asFraction(num(fee.value));
    const own = Number(office[key]);
    return Math.abs(genius - own) > RATE_EPSILON ? [`${office.cabang_name}: tarif ${label} Genius ${pct(genius)} beda dengan kategori kantor ${pct(own)}. Sistem memakai tarif kantor.`] : [];
  });
}

function geniusFigures(person: GeniusClosingPerson, prorata: number): GeniusFigures | null {
  const roy = feeOf(person, /royal/i), ssdf = feeOf(person, /ssdf/i);
  if (!roy && !ssdf) return null;
  return { genius_royalti: Math.round(num(roy?.realValue) * prorata), genius_ssdf: Math.round(num(ssdf?.realValue) * prorata) };
}

function sumFigures(list: (GeniusFigures | null)[]): GeniusFigures | null {
  const present = list.filter((f): f is GeniusFigures => f !== null);
  if (!present.length) return null;
  return { genius_royalti: present.reduce((a, f) => a + f.genius_royalti, 0), genius_ssdf: present.reduce((a, f) => a + f.genius_ssdf, 0) };
}

function resolve(side: Side, ctx: Context, closingCode: string, iso: string): Resolved {
  const p = side.person;
  if (p.type !== "INTERNAL") return { side, office: null, agent: null, hold: null };
  const code = p.agent?.employeeCode ?? "";
  const agent = code ? ctx.agentsByCode.get(code) ?? null : null;
  if (!agent) {
    const officeId = p.office ? ctx.officesByCode.get(p.office.officeCode)?.[0]?.id ?? null : null;
    return { side, office: null, agent: null, hold: { kind: "agen", code, name: p.agent?.name ?? "(tanpa nama)", closingCode, officeId } };
  }
  const office = officeAt(ctx, agent.id, iso) ?? (p.office ? ctx.officesByCode.get(p.office.officeCode)?.[0] ?? null : null);
  if (!office) {
    return { side, office: null, agent, hold: { kind: "kantor", code: p.office?.officeCode ?? "", name: p.office?.officeName ?? "(tanpa kantor)", closingCode } };
  }
  return { side, office, agent, hold: null };
}

export async function buildClosingPreview(closingCode: string, ctx: Context): Promise<ClosingPreview> {
  const base: ClosingPreview = { closingCode, error: null, closingId: null, holds: [], lines: [], invoices: [], cobroke: false, warnings: [], reported: [] };
  const c = await findClosingByCode(closingCode);
  if (!c) return { ...base, error: "Closing ID tidak ditemukan di API Genius. Kalau di aplikasi Genius ada, data server API belum diperbarui (hubungi admin sistem)." };

  const iso = (c.closingDate ?? "").slice(0, 10);
  const dpp = num(c.dppAmount);
  const resolved = sidesOf(c).map((s) => resolve(s, ctx, closingCode, iso));
  const holds = resolved.flatMap((r) => (r.hold ? [r.hold] : []));
  const cobroke = (c.closingType ?? "").includes("co_broking") || resolved.some((r) => r.side.person.type === "EXTERNAL");
  const invoices = (c.invoice ?? []).filter((v) => !v.canceledAt);
  const invoiceRows = invoices.map((v) => ({ number: v.invoiceNumber, amount: num(v.amount), phase: v.phase ?? null, totalPhase: v.totalPhase ?? null, percentage: v.percentage ?? null }));

  const lines: NewLine[] = [];
  if (holds.length === 0 && iso) {
    // Satu baris per agen REMAX: sisi agen yang sama digabung (LS); pihak luar tidak masuk GC.
    const groups = agentGroups(resolved.map((r) => ({ ...r, kind: r.side.side, agentKey: r.agent && r.office ? `${r.agent.id}|${r.office.id}` : null })));
    for (const inv of invoices) {
      const prorata = dpp > 0 ? num(inv.amount) / dpp : 0;
      for (const { members, lsl, other } of groups) {
        const { agent, office } = members[0];
        if (!agent || !office) continue;
        const gross = members.reduce((a, m) => a + num(m.side.person.commissionAmount), 0);
        const commission = dpp > 0 ? Math.round((gross * num(inv.amount)) / dpp) : 0;
        const amounts = calcAmounts(commission, Number(office.royalty_rate), Number(office.ssdf_rate));
        const otherIsExternal = other?.side.person.type === "EXTERNAL";
        lines.push({
          cabang_id: office.id,
          cabang_name: office.cabang_name,
          closing_code: closingCode,
          invoice_number: inv.invoiceNumber,
          tanggal_transaksi: iso,
          bayar_via: bayarVia(c),
          res_comm: c.listingMetadata?.listingPart?.name === "Residential" ? "RES" : "COMM",
          solo_cobroke: cobroke ? "Cobroke" : "Solo",
          psr: psrOf(c),
          lsl,
          ma_name: agent.name,
          agent_id: agent.id,
          nilai_transaksi: num(c.sellingPrice) || dpp,
          alamat: c.listingMetadata?.title ?? "",
          kantor_cobroke: other ? (otherIsExternal ? other.side.person.office?.officeName ?? null : other.office?.cabang_name ?? null) : null,
          ma_cobroke: other ? other.side.person.agent?.name ?? null : null,
          komisi_gross: amounts.komisi_gross,
          royalty_rate: Number(office.royalty_rate),
          ssdf_rate: Number(office.ssdf_rate),
          royalti: amounts.royalti,
          ppn_royalti: amounts.ppn_royalti,
          pph_royalti: amounts.pph_royalti,
          total_royalti: amounts.total_royalti,
          ssdf: amounts.ssdf,
          ppn_ssdf: amounts.ppn_ssdf,
          pph_ssdf: amounts.pph_ssdf,
          total_ssdf: amounts.total_ssdf,
          ke_rmi: amounts.ke_rmi,
          net_komisi: amounts.net_komisi,
          original: sumFigures(members.map((m) => geniusFigures(m.side.person, prorata))),
        });
      }
    }
  }
  const warnings = [...new Set(resolved.flatMap(rateWarnings))];
  return { ...base, closingId: c.closingId ?? null, holds, lines, invoices: invoiceRows, cobroke, warnings };
}
