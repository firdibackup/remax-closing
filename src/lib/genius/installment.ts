// Satu termin per closing per periode. Jika Genius belum mengisi phase,
// urutkan invoice tanpa phase berdasarkan nomor agar pilihan tetap konsisten.
export function nextInstallment(
  invoices: { number: string; phase: number | null }[],
  reported: ReadonlySet<string>,
  inPeriod: ReadonlySet<string>,
): string | null {
  if (invoices.some((invoice) => inPeriod.has(invoice.number))) return null;
  const remaining = invoices.filter((invoice) => !reported.has(invoice.number));
  remaining.sort((a, b) => (a.phase ?? Infinity) - (b.phase ?? Infinity) || a.number.localeCompare(b.number));
  return remaining[0]?.number ?? null;
}
