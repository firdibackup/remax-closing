import { headers } from "next/headers";
import { isFinanceToken } from "@/lib/auth";
import { CopyButton } from "@/components/copy-button";

// Link baca-saja untuk finance (Laporan & Rekon), hanya tampil ke superadmin. Dicabut dengan mengganti FINANCE_TOKEN.
export async function FinanceLink() {
  const token = process.env.FINANCE_TOKEN ?? "";
  if (!isFinanceToken(token)) {
    return <p className="no-print mb-4 text-[12.5px] text-[var(--muted)]">Link finance belum aktif: isi FINANCE_TOKEN (min. 24 karakter) di environment server.</p>;
  }
  const h = await headers();
  const url = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}/rekon?akses=${encodeURIComponent(token)}`;
  return (
    <details className="no-print mb-4 rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-[13px]">
      <summary className="cursor-pointer font-semibold">Link baca-saja untuk finance</summary>
      <div className="mt-2 flex items-center gap-2">
        <input readOnly value={url} aria-label="Link finance" className="min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 font-mono text-[12px]" />
        <CopyButton text={url} />
      </div>
      <p className="mt-1.5 text-[var(--muted)]">Membuka Laporan Bulanan &amp; Rekonsiliasi tanpa login, tanpa tombol ubah dan tanpa kontak kantor. Untuk mencabut, ganti FINANCE_TOKEN lalu restart server.</p>
    </details>
  );
}
