import "server-only";

import { supabaseClosingAdmin } from "@/lib/supabase/client";
import { cached } from "@/lib/closing/cache";

// Kontak kantor (PLAN §7a.1). Nomor pribadi BO/FO hanya untuk superadmin: jangan tampil di mode finance.
export type Contact = { id: string; office_id: string; jenis: string; nama: string | null; phone: string | null; email: string | null; is_primary: boolean; catatan: string | null };

// Kontak untuk follow-up: yang ditandai utama, lalu Admin, lalu yang pertama.
export const pickPrimary = (list: Contact[]): Contact | undefined =>
  list.find((c) => c.is_primary) ?? list.find((c) => c.jenis === "admin") ?? list[0];

// Semua kontak di-cache; daftar kantor tertentu (halaman Input) tetap query langsung.
export const loadContacts = (officeIds?: string[]): Promise<Map<string, Contact[]>> =>
  officeIds ? fetchContacts(officeIds) : cached("contacts", () => fetchContacts());

async function fetchContacts(officeIds?: string[]): Promise<Map<string, Contact[]>> {
  let q = supabaseClosingAdmin().from("office_contacts").select("id,office_id,jenis,nama,phone,email,is_primary,catatan").order("is_primary", { ascending: false }).limit(2000);
  if (officeIds) q = q.in("office_id", officeIds.length ? officeIds : ["00000000-0000-0000-0000-000000000000"]);
  const { data, error } = await q;
  if (error) throw new Error(`Gagal baca kontak kantor: ${error.message}`);
  const by = new Map<string, Contact[]>();
  for (const c of (data ?? []) as Contact[]) by.set(c.office_id, [...(by.get(c.office_id) ?? []), c]);
  return by;
}
