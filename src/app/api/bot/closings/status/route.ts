import { bad, json, readBody, strings, text, unauthorized } from "@/lib/bot/api";
import { findClosingByCode } from "@/lib/genius/client";
import { reportedInvoices } from "@/lib/closing/reported";

// POST /api/bot/closings/status: Closing ID mana yang sudah dilaporkan (aturan sama dengan halaman Input:
// invoice punya baris aktif atau sudah ditandai dari impor List Data Office).
// Body: { closing_codes: [...] } → invoice diambil dari Genius; atau
//       { closings: [{ closing_code, invoice_numbers: [...] }] } → tanpa panggil Genius (lebih cepat).
export const dynamic = "force-dynamic";

const MAX_CODES = 300;
const GENIUS_CONCURRENCY = 5;
const CODE_RX = /^C\d{2}F\d+\/\d{3,5}$/;

type Item = { closing_code: string; invoices: string[] | null; error?: string };

async function withInvoices(items: Item[]): Promise<Item[]> {
  const out = [...items];
  let next = 0;
  const worker = async () => {
    while (next < out.length) {
      const i = next++;
      if (out[i].invoices || out[i].error) continue;
      try {
        const c = await findClosingByCode(out[i].closing_code);
        out[i] = c ? { ...out[i], invoices: (c.invoice ?? []).filter((v) => !v.canceledAt).map((v) => v.invoiceNumber) } : { ...out[i], error: "tidak ditemukan di Genius" };
      } catch (e) {
        out[i] = { ...out[i], error: `Genius gagal: ${(e as Error).message}` };
      }
    }
  };
  await Promise.all(Array.from({ length: GENIUS_CONCURRENCY }, worker));
  return out;
}

export async function POST(req: Request) {
  const denied = unauthorized(req);
  if (denied) return denied;
  const b = await readBody(req);
  if (!b) return bad("Body harus JSON object.");
  const given: Item[] = Array.isArray(b.closings)
    ? (b.closings as unknown[]).flatMap((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const code = text(o.closing_code).toUpperCase();
      return code ? [{ closing_code: code, invoices: Array.isArray(o.invoice_numbers) ? strings(o.invoice_numbers).map((s) => s.toUpperCase()) : null }] : [];
    })
    : strings(b.closing_codes).map((c) => ({ closing_code: c.toUpperCase(), invoices: null }));
  const unique = [...new Map(given.map((g) => [g.closing_code, g])).values()];
  if (!unique.length) return bad("Isi closing_codes atau closings.");
  if (unique.length > MAX_CODES) return bad(`Maksimal ${MAX_CODES} Closing ID per request.`);

  const items = await withInvoices(unique.map((g) => (CODE_RX.test(g.closing_code) ? g : { ...g, error: "format Closing ID salah" })));
  const reported = await reportedInvoices(items.flatMap((i) => i.invoices ?? []));
  return json({
    results: items.map((i) => {
      if (i.error) return { closing_code: i.closing_code, status: "unknown", error: i.error };
      const inv = i.invoices ?? [];
      const pending = inv.filter((n) => !reported.has(n));
      const status = !inv.length ? "unknown" : !pending.length ? "reported" : pending.length === inv.length ? "not_reported" : "partial";
      return { closing_code: i.closing_code, status, invoices: inv, pending_invoices: pending, ...(inv.length ? {} : { error: "closing tanpa invoice aktif" }) };
    }),
  });
}
