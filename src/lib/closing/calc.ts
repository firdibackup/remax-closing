// Rumus template "Perhitungan Komisi" (PLAN §5). A = komisi gross; tarif dari kantor (0,5%/3% atau 1%/8%).
export const PPN = 0.11;
export const PPH_ROYALTI = 0.15;
export const PPH_SSDF = 0.02;

// Tarif per kategori List Office (PLAN §5): [royalti, SSDF].
export const KATEGORI_RATES = { "3.5": [0.005, 0.03], "9": [0.01, 0.08] } as const;

export type Amounts = {
  komisi_gross: number; royalti: number; ppn_royalti: number; pph_royalti: number; total_royalti: number;
  ssdf: number; ppn_ssdf: number; pph_ssdf: number; total_ssdf: number; ke_rmi: number; net_komisi: number;
};

export function calcAmounts(komisiGross: number, royaltyRate: number, ssdfRate: number): Amounts {
  const A = Math.round(komisiGross);
  const B = Math.round(A * royaltyRate), C = Math.round(B * PPN), D = Math.round(B * PPH_ROYALTI);
  const F = Math.round(A * ssdfRate), G = Math.round(F * PPN), H = Math.round(F * PPH_SSDF);
  const E = B + C - D, I = F + G - H;
  return { komisi_gross: A, royalti: B, ppn_royalti: C, pph_royalti: D, total_royalti: E, ssdf: F, ppn_ssdf: G, pph_ssdf: H, total_ssdf: I, ke_rmi: E + I, net_komisi: A - (B + C + F + G) };
}
