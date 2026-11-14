import "server-only";

import type {
  GeniusClosing,
  GeniusEnvelope,
  GeniusPaged,
} from "@/lib/genius/types";

// Server-only: kredensial Genius hanya dibaca dari environment server, tidak pernah ke browser.
// Login memakai POST /auth/signin lalu token Bearer dipakai untuk request berikutnya.
// Jika 401, token dibuat ulang sekali (PLAN §3.1, §11).

const DEFAULT_BASE_URL = "https://remax-api-dev.wish.co.id";
const REQUEST_TIMEOUT_MS = 60_000;
// Browser-like UA: Swagger/API menolak UA default Python dengan 403 (swagger-access.md).
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";

export class GeniusError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "GeniusError";
  }
}

type Credentials = { baseUrl: string; email: string; password: string };

function readCredentials(): Credentials {
  const email = process.env.GENIUS_EMAIL;
  const password = process.env.GENIUS_PASSWORD;
  if (!email || !password) {
    throw new Error("GENIUS_EMAIL / GENIUS_PASSWORD belum di-set di environment server.");
  }
  return {
    baseUrl: (process.env.GENIUS_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, ""),
    email,
    password,
  };
}

let cachedToken: string | null = null;

async function signIn(creds: Credentials): Promise<string> {
  const res = await fetch(`${creds.baseUrl}/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({ email: creds.email, password: creds.password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new GeniusError("Login Genius gagal", res.status, await res.text());
  }
  const json = (await res.json()) as GeniusEnvelope<{ token: string }>;
  const token = json.payload?.token;
  if (!token) throw new GeniusError("Respons login tanpa token", res.status, "");
  return token;
}

async function getToken(creds: Credentials, force = false): Promise<string> {
  if (!force && cachedToken) return cachedToken;
  cachedToken = await signIn(creds);
  return cachedToken;
}

async function geniusGet<T>(path: string, query: Record<string, string>): Promise<T> {
  const creds = readCredentials();
  const url = new URL(`${creds.baseUrl}${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));

  const send = (token: string) =>
    fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let res = await send(await getToken(creds));
  if (res.status === 401) {
    res = await send(await getToken(creds, true));
  }
  if (!res.ok) {
    throw new GeniusError(`Genius ${path} gagal`, res.status, await res.text());
  }
  return (await res.json()) as T;
}

// Cari closing persis per closingCode (mis. C26F31001/0170) beserta semua invoice-nya.
export async function findClosingByCode(closingCode: string): Promise<GeniusClosing | null> {
  const code = closingCode.trim().toUpperCase();
  const json = await geniusGet<GeniusEnvelope<GeniusPaged<GeniusClosing>>>("/closings", {
    search: code,
    includeData: "invoice",
  });
  const results = json.payload?.results ?? [];
  return results.find((c) => c.closingCode === code) ?? null;
}
