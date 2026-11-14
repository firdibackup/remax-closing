import "server-only";

import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { ACCESS_HEADER } from "@/lib/auth";
import { publicEnv } from "@/lib/supabase/client";

// Klien Supabase Auth berbasis cookie, untuk server action login/logout.
export async function supabaseAuth() {
  const store = await cookies();
  const { url, key } = publicEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) store.set(name, value, options);
      },
    },
  });
}

// true kalau request datang dari link finance (diset proxy): sembunyikan semua aksi ubah.
export async function isFinanceView(): Promise<boolean> {
  return (await headers()).get(ACCESS_HEADER) === "finance";
}
