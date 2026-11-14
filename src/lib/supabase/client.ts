import { createClient } from "@supabase/supabase-js";

// Schema aplikasi terpisah dari tabel REMAX Giving (CEO: jangan ubah tabel Giving).
// Syarat: schema `closing` harus di-expose di Supabase (Exposed schemas) dan RLS aktif.
export const CLOSING_SCHEMA = "closing";

// URL + publishable key, dipakai login (Supabase Auth) di proxy dan server action.
export function publicEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL belum di-set.");
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY belum di-set.");
  return { url, key };
}

// Klien service role, hanya untuk server (bypass RLS). Kunci dari environment server, tidak pernah ke browser.
export function supabaseClosingAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL belum di-set.");
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY belum di-set (jalankan lewat scripts/run-local.sh atau isi di .env).");
  return createClient(url, key, {
    db: { schema: CLOSING_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
