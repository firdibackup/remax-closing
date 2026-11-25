"use client";

import { ActionDialog, Field, inputCls } from "@/components/action-dialog";
import { cancelLine, cancelUpload, editLine, restoreLine } from "@/app/actions/lines";

export type EditableLine = {
  id: string; ma_name: string | null; bayar_via: string | null; res_comm: string | null; solo_cobroke: string | null; psr: string | null; lsl: string | null;
  nilai_transaksi: number; komisi_gross: number; alamat: string | null; kantor_cobroke: string | null; ma_cobroke: string | null; closing_code: string | null; label: string;
};

const opts = (name: string, value: string | null, list: string[]) => (
  <select name={name} defaultValue={value ?? ""} className={inputCls}>
    {[...new Set([value ?? "", ...list])].map((o) => <option key={o} value={o}>{o || "—"}</option>)}
  </select>
);

export function LineActions({ line }: { line: EditableLine }) {
  return (
    <div className="flex gap-1.5">
      <ActionDialog label="Ubah" title={line.ma_name ?? "Ubah baris"} eyebrow={`Ubah baris · ${line.label}`} action={editLine} submit="Simpan perubahan">
        <input type="hidden" name="id" value={line.id} />
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="MA"><input name="ma_name" defaultValue={line.ma_name ?? ""} required className={inputCls} /></Field>
          <Field label="Pembayaran via"><input name="bayar_via" defaultValue={line.bayar_via ?? ""} className={inputCls} /></Field>
          <Field label="RES / COMM">{opts("res_comm", line.res_comm, ["RES", "COMM"])}</Field>
          <Field label="Solo / Cobroke">{opts("solo_cobroke", line.solo_cobroke, ["Solo", "Cobroke"])}</Field>
          <Field label="P / S / R">{opts("psr", line.psr, ["P", "S", "R"])}</Field>
          <Field label="L / S / LS">{opts("lsl", line.lsl, ["L", "S", "LS"])}</Field>
          <Field label="Nilai transaksi"><input name="nilai_transaksi" inputMode="numeric" defaultValue={Math.round(line.nilai_transaksi)} className={`${inputCls} font-mono`} /></Field>
          <Field label="Komisi Gross (A)"><input name="komisi_gross" inputMode="numeric" required defaultValue={Math.round(line.komisi_gross)} className={`${inputCls} font-mono`} /></Field>
          <Field label="Kantor Cobroke"><input name="kantor_cobroke" defaultValue={line.kantor_cobroke ?? ""} className={inputCls} /></Field>
          <Field label="MA Cobroke"><input name="ma_cobroke" defaultValue={line.ma_cobroke ?? ""} className={inputCls} /></Field>
        </div>
        <Field label="Alamat properti & keterangan"><textarea name="alamat" rows={2} defaultValue={line.alamat ?? ""} className={inputCls} /></Field>
        <Field label="Alasan (wajib)"><input name="reason" required placeholder="mis. komisi salah ketik" className={inputCls} /></Field>
        <p className="rounded-lg bg-[var(--blue-50)] px-3 py-2 text-[12.5px] text-[var(--blue-ink)]">Royalti, SSDF, PPN, PPh, Ke RMI, dan Net dihitung ulang otomatis dengan tarif baris ini. Data Tahunan, GC, Top MA, dan Rekonsiliasi ikut berubah.</p>
      </ActionDialog>
      <ActionDialog label={<span className="text-[var(--red)]">Batalkan</span>} title={line.ma_name ?? "Batalkan baris"} eyebrow={`Batalkan baris · ${line.label}`} action={cancelLine} submit="Batalkan baris" danger>
        <input type="hidden" name="id" value={line.id} />
        {line.closing_code ? (
          <label className="flex items-start gap-2 rounded-lg border border-[var(--line)] p-3 text-[13px]">
            <input type="checkbox" name="whole" className="mt-0.5" />
            <span><b>Batalkan juga sisi lain closing {line.closing_code}</b><br /><span className="text-[var(--muted)]">Untuk co-broke antar kantor REMAX, supaya tidak tersisa setengah.</span></span>
          </label>
        ) : null}
        <Field label="Alasan (wajib)"><input name="reason" required placeholder="mis. salah input, closing dibatalkan di Genius" className={inputCls} /></Field>
        <p className="rounded-lg bg-[#FFF4DF] px-3 py-2 text-[12.5px] text-[var(--amber)]">Baris tidak dihapus permanen. Baris pindah ke daftar “Dibatalkan”, tercatat di log, dan bisa dipulihkan selama periode terbuka.</p>
      </ActionDialog>
    </div>
  );
}

export function RestoreButton({ id, label }: { id: string; label: string }) {
  return (
    <ActionDialog label="Pulihkan" title="Pulihkan baris?" eyebrow={label} action={restoreLine} submit="Pulihkan">
      <input type="hidden" name="id" value={id} />
      <p className="text-[13.5px] text-[var(--ink-2)]">Baris akan dihitung lagi di Laporan, Data Tahunan, GC, Top MA, dan Rekonsiliasi.</p>
    </ActionDialog>
  );
}

// Hapus semua baris satu closing di periode ini (Input Genius → "Sudah tersimpan"). Baris dibatalkan, bukan dihapus permanen.
export function CancelClosingButton({ lineId, closingCode, periodLabel }: { lineId: string; closingCode: string; periodLabel: string }) {
  return (
    <ActionDialog label={<span className="text-[var(--red)]">Hapus</span>} title={closingCode} eyebrow={`Hapus closing · ${periodLabel}`} action={cancelLine} submit="Hapus closing" danger>
      <input type="hidden" name="id" value={lineId} />
      <input type="hidden" name="whole" value="on" />
      <p className="text-[13px] text-[var(--ink-2)]">Semua invoice closing ini di {periodLabel} dibatalkan dan tidak dihitung lagi. Invoice-nya bisa ditarik lagi nanti.</p>
      <Field label="Alasan (wajib)"><input name="reason" required placeholder="mis. salah periode" className={inputCls} /></Field>
    </ActionDialog>
  );
}

// Hapus satu upload Excel (kantor + periode). Baris dibatalkan, tercatat di log.
export function CancelUploadButton({ officeId, periodId, cabang, periodLabel }: { officeId: string; periodId: string; cabang: string; periodLabel: string }) {
  return (
    <ActionDialog label={<span className="text-[var(--red)]">Hapus</span>} title={cabang} eyebrow={`Hapus upload Excel · ${periodLabel}`} action={cancelUpload} submit="Hapus upload" danger>
      <input type="hidden" name="office_id" value={officeId} />
      <input type="hidden" name="period_id" value={periodId} />
      <p className="text-[13px] text-[var(--ink-2)]">Semua baris Excel {cabang} di {periodLabel} dibatalkan. Upload ulang file yang benar setelahnya.</p>
      <Field label="Alasan (wajib)"><input name="reason" required placeholder="mis. file salah kantor" className={inputCls} /></Field>
    </ActionDialog>
  );
}
