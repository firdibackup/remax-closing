// Satu baris laporan = satu agen REMAX per closing (PLAN §3.4 no. 1). Sisi-sisi agen yang sama digabung:
// listing + selling → "LS". Pihak luar (agentKey null) tidak dapat baris, tapi bisa jadi kantor/MA cobroke.
export type SideKind = "listing" | "selling" | "co_listing" | "co_selling";
export type AgentGroup<T> = { members: T[]; lsl: "L" | "S" | "LS"; other: T | null };

export function lslOf(kinds: SideKind[]): "L" | "S" | "LS" {
  const listing = kinds.some((k) => k.endsWith("listing"));
  const selling = kinds.some((k) => k.endsWith("selling"));
  return listing && selling ? "LS" : listing ? "L" : "S";
}

// other = sisi pertama milik agen lain atau pihak luar (dipakai untuk kolom Kantor/MA Cobroke).
export function agentGroups<T extends { kind: SideKind; agentKey: string | null }>(sides: T[]): AgentGroup<T>[] {
  const keys = [...new Set(sides.flatMap((s) => (s.agentKey ? [s.agentKey] : [])))];
  return keys.map((key) => {
    const members = sides.filter((s) => s.agentKey === key);
    return { members, lsl: lslOf(members.map((m) => m.kind)), other: sides.find((s) => s.agentKey !== key) ?? null };
  });
}
