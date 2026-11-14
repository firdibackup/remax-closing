import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { ACCESS_HEADER, FINANCE_COOKIE, isAdminEmail, isBotPath, isBotRequest, isFinancePath, isFinanceToken } from "@/lib/auth";
import { publicEnv } from "@/lib/supabase/client";

const FINANCE_COOKIE_DAYS = 30;

// Semua halaman, ekspor, dan server action wajib login superadmin (sesi diverifikasi ke Supabase Auth).
// Finance: GET/HEAD ke Laporan & Rekon saja, lewat link ?akses=<FINANCE_TOKEN>. Bot Hermes: /api/bot/* dengan BOT_API_KEY.
export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  if (pathname === "/login") return NextResponse.next();
  // API bot: kunci BOT_API_KEY, bukan sesi login. Route handler memeriksa lagi (lapis kedua).
  if (isBotPath(pathname)) {
    return isBotRequest(request.headers.get("authorization"))
      ? NextResponse.next()
      : NextResponse.json({ status: "error", message: "Kunci bot tidak valid." }, { status: 401 });
  }

  const akses = searchParams.get("akses");
  if (akses !== null) {
    if (!isFinanceToken(akses)) return new NextResponse("Link finance tidak berlaku.", { status: 403 });
    const clean = request.nextUrl.clone();
    clean.searchParams.delete("akses");
    const res = NextResponse.redirect(clean);
    res.cookies.set(FINANCE_COOKIE, akses, { httpOnly: true, sameSite: "lax", path: "/", maxAge: FINANCE_COOKIE_DAYS * 86400 });
    return res;
  }

  // Header akses hanya boleh diisi proxy, bukan dikirim dari luar.
  const forwarded = (mode?: string) => {
    const h = new Headers(request.headers);
    h.delete(ACCESS_HEADER);
    if (mode) h.set(ACCESS_HEADER, mode);
    return h;
  };
  let response = NextResponse.next({ request: { headers: forwarded() } });
  const { url, key } = publicEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request: { headers: forwarded() } });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  // getClaims memverifikasi JWT secara lokal (kunci publik JWKS di-cache), tidak bolak-balik ke Supabase Auth
  // di setiap request seperti getUser(). Token kedaluwarsa tetap di-refresh lewat cookie.
  const { data } = await supabase.auth.getClaims();
  if (isAdminEmail(data?.claims.email)) return response;

  const isRead = request.method === "GET" || request.method === "HEAD";
  if (isRead && isFinancePath(pathname) && isFinanceToken(request.cookies.get(FINANCE_COOKIE)?.value)) {
    return NextResponse.next({ request: { headers: forwarded("finance") } });
  }
  if (!isRead) return new NextResponse("Sesi habis. Muat ulang halaman lalu login.", { status: 401 });
  const login = new URL("/login", request.url);
  login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
