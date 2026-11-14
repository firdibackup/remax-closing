import { PageHeader, Card } from "@/components/ui";
import { TransferForm } from "@/components/transfer-form";
import { supabaseClosingAdmin } from "@/lib/supabase/client";

// Pindah kantor agen (PLAN §7a.3, §9 no. 8b). Riwayat penugasan tetap; transaksi lama tidak ikut pindah.
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ agent?: string }> };

export default async function TransferPage({ searchParams }: Props) {
  const { agent } = await searchParams;
  const db = supabaseClosingAdmin();
  const [agentsRes, officesRes] = await Promise.all([
    db.from("agents").select("id,name,employee_code,status").eq("status", "aktif").order("name").limit(2000),
    db.from("offices").select("id,cabang_name,status").eq("status", "aktif").order("cabang_name").limit(1000),
  ]);
  if (agentsRes.error) throw new Error(agentsRes.error.message);
  if (officesRes.error) throw new Error(officesRes.error.message);

  const agents = (agentsRes.data ?? []).map((a) => ({ id: a.id as string, label: `${a.name} (${a.employee_code})` }));
  const offices = (officesRes.data ?? []).map((o) => ({ id: o.id as string, label: o.cabang_name as string }));

  return (
    <main className="mx-auto max-w-4xl p-6">
      <PageHeader eyebrow="Master · agen" title="Pindah kantor agen" desc="Penugasan lama ditutup sehari sebelum tanggal efektif. Transaksi sebelum tanggal itu tetap di kantor lama, termasuk yang baru dilaporkan nanti." />
      <Card className="p-5">
        <TransferForm agents={agents} offices={offices} agentId={agents.some((a) => a.id === agent) ? agent : ""} />
      </Card>
    </main>
  );
}
