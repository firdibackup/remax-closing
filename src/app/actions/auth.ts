"use server";

import { redirect } from "next/navigation";
import { isAdminEmail, safeNext } from "@/lib/auth";
import { fail, str, type ActionResult } from "@/lib/closing/audit";
import { supabaseAuth } from "@/lib/supabase/auth-server";

export async function login(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const email = str(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return fail("Email dan password wajib diisi.");
  if (!isAdminEmail(email)) return fail("Email ini tidak punya akses ke Reporting Closing.");
  const { error } = await (await supabaseAuth()).auth.signInWithPassword({ email, password });
  if (error) return fail(/invalid login credentials/i.test(error.message) ? "Email atau password salah." : `Gagal login: ${error.message}`);
  redirect(safeNext(str(fd, "next")));
}

export async function logout() {
  const { error } = await (await supabaseAuth()).auth.signOut();
  if (error) throw new Error(`Gagal keluar: ${error.message}`);
  redirect("/login");
}
