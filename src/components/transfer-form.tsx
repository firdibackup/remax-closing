"use client";

import { useActionState } from "react";
import { transferAgent } from "@/app/actions/transfer";
import { btnPriCls, selectCls } from "@/components/ui";
import { useReportPending } from "@/components/pending";
import { PendingButton } from "@/components/spinner";
import type { ActionResult } from "@/lib/closing/audit";

export type AgentOption = { id: string; label: string };
export type OfficeOption = { id: string; label: string };

export function TransferForm({ agents, offices, agentId = "" }: { agents: AgentOption[]; offices: OfficeOption[]; agentId?: string }) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(transferAgent, null);
  useReportPending(pending);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} aria-busy={pending || undefined} className="grid gap-3 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-semibold">
        Agen
        <select name="agent_id" required defaultValue={agentId} className={selectCls}>
          <option value="">— pilih agen —</option>
          {agents.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Kantor tujuan
        <select name="office_id" required className={selectCls}>
          <option value="">— pilih kantor —</option>
          {offices.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Tanggal efektif
        <input type="date" name="effective" defaultValue={today} required className={selectCls} />
      </label>
      <label className="flex items-start gap-2 text-[13px] sm:col-span-2">
        <input type="checkbox" name="move_open" defaultChecked className="mt-0.5" />
        <span><b>Tanggal mundur:</b> pindahkan juga transaksi agen di kantor lama yang bertanggal sejak tanggal efektif, bila periodenya masih terbuka (dihitung ulang dengan tarif kantor baru). Periode terkunci tidak diubah.</span>
      </label>
      <div className="flex items-end">
        <PendingButton type="submit" pending={pending} pendingText="Memindahkan…" className={btnPriCls}>Pindahkan agen</PendingButton>
      </div>
      {state && (
        <p className={`sm:col-span-2 rounded-lg p-3 text-sm ${state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>
      )}
    </form>
  );
}
