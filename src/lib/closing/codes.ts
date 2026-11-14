// Parser Closing ID dari teks tempel (WhatsApp/Excel). Murni, dipakai server dan browser (chip langsung saat mengetik).
const CLOSING_CODE_RX = /C\d{2}F\d+\/\d{3,5}/gi;
const INVOICE_CODE_RX = /I\d{2}F\d+\/\d{3,5}/gi;
const LIST_NUMBER_RX = /^\s*\d+\s*[.)]/;
const SEPARATORS_RX = /[-–&,;:\s*]+/g;
const LOOKS_LIKE_CODE_RX = /[A-Z]\d{2}F/i;

export type ParsedText = { codes: string[]; dup: string[]; bad: string[]; invoices: number };

// codes = Closing ID unik sesuai urutan; dup = yang tertulis lagi; invoices = Invoice ID ikut tertempel (diabaikan);
// bad = sisa teks yang mirip kode tapi formatnya salah (mis. "/" hilang).
export function parseClosingText(text: string): ParsedText {
  const codes: string[] = [], dup: string[] = [], bad: string[] = [];
  let invoices = 0;
  for (const line of text.split("\n")) {
    for (const c of (line.match(CLOSING_CODE_RX) ?? []).map((x) => x.toUpperCase())) (codes.includes(c) ? dup : codes).push(c);
    invoices += (line.match(INVOICE_CODE_RX) ?? []).length;
    const rest = line.replace(CLOSING_CODE_RX, "").replace(INVOICE_CODE_RX, "").replace(LIST_NUMBER_RX, "").replace(SEPARATORS_RX, "");
    if (rest && LOOKS_LIKE_CODE_RX.test(rest)) bad.push(rest.toUpperCase());
  }
  return { codes, dup, bad, invoices };
}

export const parseCodes = (text: string): string[] => parseClosingText(text).codes;
