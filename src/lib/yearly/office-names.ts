// Nama cabang di Master Data tahunan (kolom RE/MAX: "PREMIER_JGC", "360 (MPS)", "Fast_Rawamangun") → offices.cabang_name.
// Port dari scripts/office_names.py (ALIASES dicek admin sekali), ditambah keputusan HQ untuk impor tahunan:
// 360 (MPS) dan 360 (TSP) digabung ke _360. Murni, tanpa I/O.

const PREFIX = /^\s*(RE\/?MAX|REMX)\s+/i;

// Kunci nama kantor: tanpa awalan REMAX, hanya huruf/angka besar ("Fast_Rawamangun" = "FAST_RAWAMANGUN" = "FASTRAWAMANGUN").
export const officeKey = (name: string | null | undefined) => (name ?? "").replace(PREFIX, "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Kunci = officeKey(nama di file); nilai = cabang_name di master. Satu nama bisa menunjuk beberapa cabang (hanya saran).
export const OFFICE_ALIASES: Record<string, string[]> = {
  EAGLE: ["EAGLE_CITRALAND"],
  FASTOAK: ["Fast_Oak_Tower"],
  FASTTHEOAKTOWER: ["Fast_Oak_Tower"],
  GOLDENSTAR: ["GOLDENSTAR", "GOLDENSTAR (CV PSM)", "GOLDENSTAR (PT PSP)"],
  JAYA: ["JAYA_GATSU"],
  PREMIERJGC: ["PREMIER_JGC", "PREMIER_JGC (CV MPP)", "PREMIER_JGC (PT MPP)"],
  RITZGLC: ["RITZ_GREEN_LAKE_CITY"],
  SOLITAIRE: ["SOLITAIRE (M)", "SOLITAIRE (P)"],
  "360MPS": ["_360"],
  "360TSP": ["_360"],
};

export type NamedOffice = { cabang_name: string };

// Kantor yang namanya sama persis (setelah normalisasi), dan kantor dari daftar alias.
export function officeCandidates<T extends NamedOffice>(name: string, offices: T[]): { exact: T[]; alias: T[] } {
  const key = officeKey(name);
  if (!key) return { exact: [], alias: [] };
  const exact = offices.filter((o) => officeKey(o.cabang_name) === key);
  const names = OFFICE_ALIASES[key] ?? [];
  const alias = offices.filter((o) => names.includes(o.cabang_name) && !exact.includes(o));
  return { exact, alias };
}
