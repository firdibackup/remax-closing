"use client";

import { ActionDialog, Field, inputCls } from "@/components/action-dialog";
import { deleteAgent, deleteOffice, markNihil, saveAgent, saveOffice, setPeriodStatus, setRecon } from "@/app/actions/admin";
import { undoTransfer } from "@/app/actions/transfer";
import type { ReactNode } from "react";

// Default "buka sampai": 24 jam dari sekarang, dalam jam dinding WIB (UTC+7) untuk <input type="datetime-local">.
const UNLOCK_DEFAULT_HOURS = 24;
const WIB_OFFSET_HOURS = 7;
const tomorrowWib = () => new Date(Date.now() + (UNLOCK_DEFAULT_HOURS + WIB_OFFSET_HOURS) * 3_600_000).toISOString().slice(0, 16);

const sel = (name: string, value: string, list: [string, string][]) => (
  <select name={name} defaultValue={value} className={inputCls}>{list.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
);

export function ReconForm({ periodId, cabangId, cabang, status, catatan, badge }: { periodId: string; cabangId: string; cabang: string; status: string; catatan: string; badge: ReactNode }) {
  return (
    <ActionDialog label={badge} triggerClass="rounded-full" title={cabang} eyebrow="Status rekonsiliasi" action={setRecon} submit="Simpan">
      <input type="hidden" name="period_id" value={periodId} />
      <input type="hidden" name="cabang_id" value={cabangId} />
      <Field label="Status">{sel("status", status, [["", "Belum dicek"], ["Done", "Done"], ["Selisih", "Selisih"], ["Belum kirim", "Belum kirim"], ["Nihil", "Nihil"]])}</Field>
      <Field label="Catatan"><input name="catatan" defaultValue={catatan} placeholder="mis. selisih Rp2 pembulatan" className={inputCls} /></Field>
    </ActionDialog>
  );
}

export function NihilButton({ periodId, cabangId, cabang, periodLabel }: { periodId: string; cabangId: string; cabang: string; periodLabel: string }) {
  return (
    <ActionDialog label="Nihil" triggerClass="rounded-md border border-[var(--line)] bg-white px-2 py-0.5 text-[11.5px] font-semibold hover:bg-[var(--bg)]" title={cabang} eyebrow={`Tandai Nihil · ${periodLabel}`} action={markNihil} submit="Tandai Nihil">
      <input type="hidden" name="period_id" value={periodId} />
      <input type="hidden" name="cabang_id" value={cabangId} />
      <p className="text-[13px] text-[var(--ink-2)]">Kantor ini tidak ada closing di {periodLabel}. Status muncul di Rekonsiliasi dan bisa diubah di sana.</p>
      <Field label="Catatan"><input name="catatan" placeholder="opsional, mis. konfirmasi admin via WA" className={inputCls} /></Field>
    </ActionDialog>
  );
}

export function PeriodToggle({ id, label, locked }: { id: string; label: string; locked: boolean }) {
  return (
    <ActionDialog label={locked ? "Buka kunci" : "Kunci"} title={`${locked ? "Buka kunci" : "Kunci"} ${label}?`} eyebrow="Periode & Cut-off" action={setPeriodStatus} submit={locked ? "Buka kunci" : "Kunci periode"} danger={locked}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={locked ? "open" : "locked"} />
      <Field label="Alasan"><input name="reason" required={locked} placeholder={locked ? "mis. koreksi komisi kantor X" : "opsional"} className={inputCls} /></Field>
      {locked ? <Field label="Buka sampai (WIB)" hint="Lewat dari batas ini, periode terkunci otomatis lagi."><input type="datetime-local" name="until" required defaultValue={tomorrowWib()} className={inputCls} /></Field> : null}
      <p className="text-[12.5px] text-[var(--muted)]">{locked ? "Selama terbuka, baris bisa diubah, dibatalkan, dan diinput. Tercatat di log." : "Setelah dikunci, laporan bulan ini tidak bisa diubah sampai dibuka lagi."}</p>
    </ActionDialog>
  );
}

export type OfficeVal = { id?: string; office_code: string; induk_name: string; cabang_name: string; kategori: string; report_channel: string; status: string; alamat?: string | null };
// initial = isian awal untuk kantor baru (mis. Office ID dari Genius saat closing ditahan).
export function OfficeForm({ office, initial, label, triggerClass }: { office?: OfficeVal; initial?: Partial<OfficeVal>; label: ReactNode; triggerClass?: string }) {
  const v = office ?? { office_code: "", induk_name: "", cabang_name: "", kategori: "", report_channel: "GENIUS", status: "aktif", alamat: "", ...initial };
  return (
    <ActionDialog label={label} triggerClass={triggerClass} title={office ? office.cabang_name : "Tambah kantor"} eyebrow={office ? "Ubah kantor" : "Kantor baru"} action={saveOffice} submit="Simpan">
      {office?.id ? <input type="hidden" name="id" value={office.id} /> : null}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Office ID (Genius)"><input name="office_code" defaultValue={v.office_code} required placeholder="F21xxx" className={`${inputCls} font-mono`} /></Field>
        <Field label="Office induk"><input name="induk_name" defaultValue={v.induk_name} required placeholder="mis. EAGLE" className={inputCls} /></Field>
      </div>
      <Field label="Nama cabang (RE/MAX)"><input name="cabang_name" defaultValue={v.cabang_name} required placeholder="mis. EAGLE_CITRALAND" className={inputCls} /></Field>
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Field label="Kategori tarif">{sel("kategori", v.kategori, [["", "— pilih —"], ["3.5", "3,5% + PPN"], ["9", "9% + PPN"]])}</Field>
        <Field label="Kanal lapor">{sel("report_channel", v.report_channel ?? "GENIUS", [["GENIUS", "Genius"], ["EXCEL", "Excel"], ["NIHIL", "Nihil"]])}</Field>
        <Field label="Status">{sel("status", v.status, [["aktif", "Aktif"], ["tutup", "Tutup"]])}</Field>
      </div>
      <Field label="Alamat"><textarea name="alamat" rows={2} defaultValue={v.alamat ?? ""} className={inputCls} /></Field>
      <p className="rounded-lg bg-[var(--blue-50)] px-3 py-2 text-[12.5px] text-[var(--blue-ink)]">Kategori wajib dipilih admin (sistem tidak menebak). Perubahan kategori hanya berlaku untuk input berikutnya.</p>
    </ActionDialog>
  );
}

export type AgentVal = { id?: string; employee_code: string; name: string; full_name?: string | null; sheet_name?: string | null; role: string; status: string };
export function AgentForm({ agent, initial, offices, label, triggerClass }: { agent?: AgentVal; initial?: Partial<AgentVal>; offices: { id: string; cabang_name: string }[]; label: ReactNode; triggerClass?: string }) {
  const v = agent ?? { employee_code: "", name: "", full_name: "", sheet_name: "", role: "agent_property", status: "aktif", ...initial };
  const today = new Date().toISOString().slice(0, 10);
  return (
    <ActionDialog label={label} triggerClass={triggerClass} title={agent ? agent.name : "Tambah agen"} eyebrow={agent ? "Ubah agen" : "Agen baru"} action={saveAgent} submit="Simpan">
      {agent?.id ? <input type="hidden" name="id" value={agent.id} /> : null}
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Agent ID (Genius)" hint="Kunci pencocokan dengan employeeCode Genius"><input name="employee_code" defaultValue={v.employee_code} required placeholder="A26xxx" className={`${inputCls} font-mono`} /></Field>
        <Field label="Role">{sel("role", v.role, [["agent_property", "Agent Property"], ["franchise_owner", "Franchise Owner"]])}</Field>
        <Field label="Nama"><input name="name" defaultValue={v.name} required className={inputCls} /></Field>
        <Field label="Nama lengkap"><input name="full_name" defaultValue={v.full_name ?? ""} className={inputCls} /></Field>
        <Field label="Nama di laporan / alias" hint="Nama yang dipakai di file Excel kantor"><input name="sheet_name" defaultValue={v.sheet_name ?? ""} className={inputCls} /></Field>
        <Field label="Status">{sel("status", v.status, [["aktif", "Aktif"], ["resign", "Resign"]])}</Field>
      </div>
      {agent ? null : (
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Kantor"><select name="office_id" required className={inputCls}>{offices.map((o) => <option key={o.id} value={o.id}>{o.cabang_name}</option>)}</select></Field>
          <Field label="Bergabung sejak"><input type="date" name="start_date" defaultValue={today} required className={inputCls} /></Field>
        </div>
      )}
    </ActionDialog>
  );
}

const dangerSm = "rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-[12.5px] font-semibold text-[var(--red)] hover:bg-[var(--red-50)]";

// Kantor bertransaksi/beragen hanya bisa ditandai Tutup (server memeriksa ulang).
export function DeleteOfficeButton({ id, name, lines, agents }: { id: string; name: string; lines: number; agents: number }) {
  const used = lines > 0 || agents > 0;
  return (
    <ActionDialog label={used ? "Tandai Tutup" : "Hapus"} triggerClass={dangerSm} title={used ? `Kantor ${name} tidak bisa dihapus` : `Hapus ${name}?`} eyebrow="Master kantor" action={deleteOffice} submit={used ? "Tandai Tutup" : "Hapus"} danger>
      <input type="hidden" name="id" value={id} />
      <p className="text-[13px] text-[var(--ink-2)]">{used ? <><b>{name}</b> punya {lines} transaksi dan {agents} agen (termasuk riwayat). Agar laporan lama tetap utuh, kantor cukup ditandai <b>Tutup</b>.</> : <>Kantor ini belum punya transaksi atau agen. Hapus dari master beserta kontaknya?</>}</p>
    </ActionDialog>
  );
}

export function DeleteAgentButton({ id, name, lines }: { id: string; name: string; lines: number }) {
  return (
    <ActionDialog label={lines ? "Tandai Resign" : "Hapus"} triggerClass={dangerSm} title={lines ? `Agen ${name} tidak bisa dihapus` : `Hapus ${name}?`} eyebrow="Master agen" action={deleteAgent} submit={lines ? "Tandai Resign" : "Hapus"} danger>
      <input type="hidden" name="id" value={id} />
      <p className="text-[13px] text-[var(--ink-2)]">{lines ? <><b>{name}</b> punya {lines} transaksi. Agar laporan dan Top MA tetap utuh, status diubah menjadi <b>Resign</b>.</> : <>Agen ini belum punya transaksi. Hapus dari master beserta riwayat kantornya?</>}</p>
    </ActionDialog>
  );
}

export function UndoTransferButton({ agentId, name, backTo }: { agentId: string; name: string; backTo: string }) {
  return (
    <ActionDialog label="Batalkan pindah terakhir" triggerClass="rounded-lg px-0 py-1 text-[12.5px] font-semibold text-[var(--blue)]" title="Batalkan pindah terakhir?" eyebrow={name} action={undoTransfer} submit="Batalkan pindah">
      <input type="hidden" name="agent_id" value={agentId} />
      <p className="text-[13px] text-[var(--ink-2)]">Kembalikan <b>{name}</b> ke {backTo}. Hanya bisa selama belum ada transaksi Genius/Excel di kantor baru. Tercatat di log.</p>
    </ActionDialog>
  );
}
