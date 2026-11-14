"use client";

import { ActionDialog, Field, inputCls } from "@/components/action-dialog";
import { deleteContact, saveContact } from "@/app/actions/admin";
import { telLink, waLink } from "@/lib/closing/phone";

export type ContactVal = { id?: string; office_id: string; jenis: string; nama: string | null; phone: string | null; email: string | null; is_primary: boolean; catatan: string | null };

export const JENIS_LABEL: Record<string, string> = { admin: "Admin", bo: "BO", franchise_owner: "Franchise Owner", lainnya: "Lainnya" };
const linkCls = "rounded-md border border-[var(--line)] px-1.5 py-0.5 text-[11.5px] font-semibold no-underline hover:bg-[var(--bg)]";

// Tombol WhatsApp & Telepon (PLAN §7a.1).
export function ContactLinks({ contact }: { contact: Pick<ContactVal, "jenis" | "nama" | "phone"> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <span><b>{JENIS_LABEL[contact.jenis] ?? contact.jenis}</b>{contact.nama ? ` · ${contact.nama}` : ""}</span>
      {contact.phone ? (
        <>
          <a href={waLink(contact.phone)} target="_blank" rel="noopener noreferrer" className={`${linkCls} text-[var(--green)]`}>WA</a>
          <a href={telLink(contact.phone)} className={`${linkCls} text-[var(--ink-2)]`}>{contact.phone}</a>
        </>
      ) : <span className="text-[var(--muted)]">tanpa nomor</span>}
    </span>
  );
}

export function ContactForm({ contact, officeId, cabang, label }: { contact?: ContactVal; officeId: string; cabang: string; label: string }) {
  const v = contact ?? { office_id: officeId, jenis: "admin", nama: "", phone: "", email: "", is_primary: false, catatan: "" };
  return (
    <ActionDialog label={label} title={cabang} eyebrow={contact ? "Ubah kontak" : "Kontak baru"} action={saveContact} submit="Simpan">
      {contact?.id ? <input type="hidden" name="id" value={contact.id} /> : null}
      <input type="hidden" name="office_id" value={officeId} />
      <div className="grid gap-2.5 sm:grid-cols-2">
        <Field label="Jenis">
          <select name="jenis" defaultValue={v.jenis} className={inputCls}>{Object.entries(JENIS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </Field>
        <Field label="Nama"><input name="nama" defaultValue={v.nama ?? ""} className={inputCls} /></Field>
        <Field label="Telepon / WA" hint="Disimpan sebagai +62…"><input name="phone" type="tel" defaultValue={v.phone ?? ""} placeholder="0812-3456-7890" className={inputCls} /></Field>
        <Field label="Email"><input name="email" type="email" defaultValue={v.email ?? ""} className={inputCls} /></Field>
      </div>
      <Field label="Catatan"><input name="catatan" defaultValue={v.catatan ?? ""} className={inputCls} /></Field>
      <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" name="is_primary" defaultChecked={v.is_primary} /> Kontak utama (dipakai untuk follow-up WA)</label>
    </ActionDialog>
  );
}

export function DeleteContact({ id, name }: { id: string; name: string }) {
  return (
    <ActionDialog label="Hapus" title={`Hapus kontak ${name}?`} eyebrow="Kontak kantor" action={deleteContact} submit="Hapus" danger>
      <input type="hidden" name="id" value={id} />
      <p className="text-[13px] text-[var(--ink-2)]">Kontak dihapus dari kantor ini. Tercatat di log.</p>
    </ActionDialog>
  );
}
