import { json, modeOf, unauthorized } from "@/lib/bot/api";
import { pickRecipient } from "@/lib/bot/schedule";
import { loadContacts } from "@/lib/closing/contacts";
import { loadActiveOffices } from "@/lib/closing/period-data";
import { normalizePhone } from "@/lib/closing/phone";

// GET /api/bot/offices: kantor aktif + nomor WA (kontak utama, Admin, BO). Satu baris per cabang.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const [offices, contacts] = await Promise.all([loadActiveOffices(), loadContacts()]);
  return json({
    offices: offices.map((o) => {
      const list = contacts.get(o.id) ?? [];
      const first = (jenis: string) => list.map((c) => (c.jenis === jenis ? normalizePhone(c.phone) : null)).find(Boolean) ?? null;
      const to = pickRecipient(list);
      return {
        cabang_id: o.id, office_code: o.office_code, cabang_name: o.cabang_name, induk_name: o.induk_name,
        report_channel: o.report_channel, mode: modeOf(o.report_channel),
        send_to: to?.phone ?? null, contact_jenis: to?.jenis ?? null, wa_admin: first("admin"), wa_bo: first("bo"),
      };
    }),
  });
}
