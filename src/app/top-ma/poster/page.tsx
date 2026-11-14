import { redirect } from "next/navigation";
import { parseRole } from "@/lib/top-ma/data";

// Halaman lama poster: sekarang poster dibuka sebagai drawer di /top-ma (?poster=top10). Link lama tetap jalan.
type Props = { searchParams: Promise<{ bulan?: string; role?: string }> };

export default async function TopMaPosterRedirect({ searchParams }: Props) {
  const sp = await searchParams;
  const month = Number(sp.bulan);
  const role = parseRole(sp.role);
  const ok = Number.isInteger(month) && month >= 1 && month <= 12;
  redirect(`/top-ma?${new URLSearchParams({ ...(ok ? { bulan: String(month), poster: "top10" } : {}), ...(role ? { role } : {}) })}`);
}
