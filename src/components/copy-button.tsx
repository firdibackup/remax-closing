"use client";

import { useState } from "react";
import { btnCls } from "@/components/ui";

export function CopyButton({ text, label = "Salin link" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback untuk http non-localhost (clipboard API butuh secure context).
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" onClick={copy} className={`${btnCls} flex-none !py-1.5 !text-[12.5px]`} aria-live="polite">
      {copied ? "Tersalin ✓" : label}
    </button>
  );
}
