"use client";

import { ActionDialog, Field, inputCls } from "@/components/action-dialog";
import { saveBotSettings } from "@/app/actions/bot";

export type BotSettingsVal = { active: boolean; send_days: number[]; send_hour: number; drive_url: string | null };

// Ubah pengaturan reminder WA bot (halaman Periode & Cut-off).
export function BotSettingsForm({ settings }: { settings: BotSettingsVal }) {
  return (
    <ActionDialog label="Ubah" title="Reminder WhatsApp (bot)" eyebrow="Periode & Cut-off" action={saveBotSettings} submit="Simpan">
      <label className="flex items-center gap-2 text-[13.5px] font-semibold text-[var(--ink-2)]">
        <input type="checkbox" name="active" defaultChecked={settings.active} className="h-4 w-4" />
        Bot aktif (kirim reminder sesuai jadwal)
      </label>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Tanggal kirim" hint="Angka 1–31, dipisah koma">
          <input name="send_days" required defaultValue={settings.send_days.join(", ")} placeholder="25, 1, 3" className={inputCls} />
        </Field>
        <Field label="Jam kirim (WIB)" hint="0–23, mis. 9 = 09:00">
          <input type="number" name="send_hour" required min={0} max={23} defaultValue={settings.send_hour} className={inputCls} />
        </Field>
      </div>
      <Field label="Link folder Google Drive" hint="Untuk kantor Excel mengunggah laporan (opsional)">
        <input type="url" name="drive_url" defaultValue={settings.drive_url ?? ""} placeholder="https://drive.google.com/drive/folders/…" className={inputCls} />
      </Field>
      <p className="rounded-lg bg-[var(--blue-50)] px-3 py-2 text-[12.5px] text-[var(--blue-ink)]">Bot mengirim ke satu nomor per cabang: kontak utama, biasanya Admin. Kalau tidak ada, ke BO. Kantor Genius menerima daftar Closing ID untuk dikonfirmasi; kantor Excel diminta mengunggah file ke folder Drive.</p>
    </ActionDialog>
  );
}
