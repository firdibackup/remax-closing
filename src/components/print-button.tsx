"use client";

import { btnCls } from "@/components/ui";

// Cetak / simpan PDF lewat dialog print browser (PLAN §7: finance lewat PDF). Tampilan cetak diatur di globals.css.
export function PrintButton() {
  return <button type="button" onClick={() => window.print()} className={btnCls}>Cetak / PDF</button>;
}
