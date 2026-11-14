"use client";

import { useState } from "react";
import { parseClosingText } from "@/lib/closing/codes";
import { NavSubmit } from "@/components/pending";

const MAX_CHIPS = 30;

// Textarea Closing ID + chip "terbaca otomatis" (dobel, Invoice ID ikut tertempel, teks tak terbaca) saat mengetik.
export function ClosingCodesInput({ defaultValue }: { defaultValue: string }) {
  const [text, setText] = useState(defaultValue);
  const { codes, dup, bad, invoices } = parseClosingText(text);
  return (
    <div className="grid gap-1.5">
      <textarea
        name="codes"
        aria-label="Daftar Closing ID"
        rows={7}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"C26F31001/0201\nC26F281001/0202\nC26F21025/0203\n\nBoleh campur kantor. Tempel dari WhatsApp/Excel."}
        className="rounded-lg border border-[var(--line)] p-3 font-mono text-[13px] font-normal"
      />
      <small className="text-[12px] font-normal text-[var(--muted)]">
        Terbaca {codes.length} Closing ID{dup.length ? ` · ${dup.length} dobel` : ""}{invoices ? ` · ${invoices} Invoice ID diabaikan` : ""}
      </small>
      {codes.length || bad.length ? (
        <div className="flex flex-wrap gap-1.5">
          {codes.slice(0, MAX_CHIPS).map((c) => <span key={c} className="rounded-lg border border-[var(--line)] bg-white px-2 py-0.5 font-mono text-[12px] font-normal">{c}</span>)}
          {codes.length > MAX_CHIPS ? <span className="rounded-lg border border-[var(--line)] px-2 py-0.5 text-[12px] font-normal">+{codes.length - MAX_CHIPS}</span> : null}
          {bad.map((b, i) => <span key={`${b}-${i}`} className="rounded-lg border border-[#F3B7BE] bg-[var(--red-50)] px-2 py-0.5 text-[12px] font-normal text-[var(--red)]">tak terbaca: {b}</span>)}
        </div>
      ) : null}
      <NavSubmit disabled={!codes.length} pendingText="Menarik dari Genius…" className="mt-1 justify-self-start rounded-lg bg-[var(--blue)] px-3.5 py-2 text-[13.5px] font-semibold text-white hover:bg-[var(--blue-ink)] disabled:opacity-50">Tarik dari Genius</NavSubmit>
    </div>
  );
}
