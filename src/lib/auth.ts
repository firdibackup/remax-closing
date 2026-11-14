// Akses aplikasi (PLAN §7, §9 no. 1). Supabase Auth dipakai bersama REMAX Giving, jadi login dibatasi
// daftar email ADMIN_EMAILS. Finance tidak login: link berisi FINANCE_TOKEN, hanya baca Laporan & Rekon.
// Dipakai proxy dan server; tidak boleh mengimpor modul server-only.

export const FINANCE_COOKIE = "finance_akses";
export const ACCESS_HEADER = "x-akses";
export const FINANCE_PATHS = ["/laporan", "/rekon"];
const MIN_TOKEN_LENGTH = 24;

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

// Perbandingan waktu-tetap supaya token tidak bisa ditebak per karakter. Token server kosong/pendek = fitur nonaktif.
export function tokenMatches(expected: string | undefined, token: string | null | undefined): boolean {
  const want = expected ?? "";
  if (want.length < MIN_TOKEN_LENGTH || !token || token.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}

export const isFinanceToken = (token: string | null | undefined) => tokenMatches(process.env.FINANCE_TOKEN, token);

// Bot WhatsApp (Hermes): /api/bot/* tidak memakai sesi login, tapi header "Authorization: Bearer <BOT_API_KEY>".
export const BOT_PATH_PREFIX = "/api/bot/";
export const isBotPath = (pathname: string) => pathname.startsWith(BOT_PATH_PREFIX);
export function isBotRequest(authorization: string | null): boolean {
  const m = /^Bearer\s+(\S+)$/i.exec(authorization ?? "");
  return tokenMatches(process.env.BOT_API_KEY, m?.[1]);
}

export const isFinancePath = (pathname: string) => FINANCE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

// Tujuan setelah login: hanya path relatif di aplikasi ini (cegah open redirect).
export const safeNext = (next: string | null | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
