import "server-only";

import { isBotRequest } from "@/lib/auth";
import { supabaseClosingAdmin } from "@/lib/supabase/client";
import type { PeriodLike } from "@/lib/closing/periods";

// Bantuan route handler /api/bot/*. Proxy sudah memeriksa kunci; di sini diperiksa lagi supaya route
// tetap aman kalau matcher proxy berubah.

export const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD_RX = /^(\d{4})-(\d{2})$/;

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const bad = (message: string, status = 400) => json({ status: "error", message }, status);

export function unauthorized(req: Request): Response | null {
  return isBotRequest(req.headers.get("authorization")) ? null : bad("Kunci bot tidak valid.", 401);
}

export async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const b = await req.json();
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean) : []);
export const isoOrNull = (v: unknown): string | null => {
  const s = text(v);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};

export type PeriodRec = PeriodLike & { id: string };
export async function periodByKey(key: string): Promise<PeriodRec | null> {
  const m = PERIOD_RX.exec(key);
  if (!m) return null;
  const { data, error } = await supabaseClosingAdmin().from("periods").select("id,year,month,status,cutoff_at").eq("year", Number(m[1])).eq("month", Number(m[2])).maybeSingle();
  if (error) throw new Error(`Gagal baca periode: ${error.message}`);
  return (data as PeriodRec | null) ?? null;
}

export type OfficeRec = { id: string; office_code: string; cabang_name: string; induk_name: string; report_channel: string | null; status: string };
export async function officeById(id: string): Promise<OfficeRec | null> {
  if (!UUID_RX.test(id)) return null;
  const { data, error } = await supabaseClosingAdmin().from("offices").select("id,office_code,cabang_name,induk_name,report_channel,status").eq("id", id).maybeSingle();
  if (error) throw new Error(`Gagal baca kantor: ${error.message}`);
  return (data as OfficeRec | null) ?? null;
}

// Kanal lapor kantor → isi reminder: Excel = minta upload ke Drive; selain itu konfirmasi Closing ID Genius.
export const modeOf = (channel: string | null) => (channel === "EXCEL" ? "excel" : "genius") as "excel" | "genius";
