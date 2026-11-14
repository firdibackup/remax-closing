import type { Metadata } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { autoLockPeriods } from "@/lib/closing/auto-lock";
import { pendingOfficeCount } from "@/lib/closing/period-data";
import { isFinanceView } from "@/lib/supabase/auth-server";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const interTight = Inter_Tight({ variable: "--font-inter-tight", subsets: ["latin"], weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: "REMAX Reporting Closing",
  description: "Reporting Closing RE/MAX HQ",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Gagal kunci otomatis tidak boleh mematikan semua halaman; penulisan tetap dijaga isWritable() di server action.
  try {
    await autoLockPeriods();
  } catch (e) {
    console.error("[auto-lock]", e);
  }
  const mode = (await isFinanceView()) ? "finance" : "admin";
  // Badge "kantor belum lapor" di menu Beranda; gagal hitung tidak boleh mematikan halaman.
  let pending = 0;
  if (mode === "admin") {
    try {
      pending = await pendingOfficeCount();
    } catch (e) {
      console.error("[pending-offices]", e);
    }
  }
  return (
    <html lang="id" className={`${inter.variable} ${interTight.variable} h-full antialiased`}>
      <body className="min-h-full">
        <AppShell mode={mode} pending={pending}>{children}</AppShell>
      </body>
    </html>
  );
}
