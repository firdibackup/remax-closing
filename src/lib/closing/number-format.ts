const numberFormat = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 2 });

export const fmt = (n: number) => numberFormat.format(n);
export const rupiah = (n: number) => `Rp${fmt(n)}`;
