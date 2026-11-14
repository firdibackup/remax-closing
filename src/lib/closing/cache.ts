import "server-only";

import { revalidatePath } from "next/cache";

// Cache memori proses server untuk data yang dibaca hampir semua halaman (commission_lines ±3 MB, periode, kantor, kontak).
// Tanpa ini setiap pindah halaman mengunduh ulang seluruh tabel dari Supabase (±2–6 detik).
// Cache dikosongkan setiap ada perubahan lewat aplikasi (audit() dan refreshAll()); perubahan dari luar aplikasi
// (skrip impor Python, edit langsung di Supabase) terlihat setelah TTL lewat (muat ulang halaman sekali lagi).
const TTL_MS = 5 * 60_000;

type Entry = { at: number; value: Promise<unknown> };
type Store = { entries: Map<string, Entry> };

// Disimpan di globalThis supaya halaman, route handler, dan server action berbagi satu cache walau modulnya di-bundle terpisah.
const KEY = Symbol.for("remax-closing.data-cache");
const g = globalThis as typeof globalThis & { [KEY]?: Store };
const store: Store = (g[KEY] ??= { entries: new Map() });

// Satu permintaan jalan untuk request bersamaan (prefetch menu); hasil gagal tidak disimpan.
// Lewat TTL: data lama tetap dipakai sekali lagi sambil dimuat ulang di belakang (halaman tidak menunggu).
export function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = store.entries.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  store.entries.set(key, { at: Date.now(), value });
  value.catch(() => {
    if (store.entries.get(key)?.value === value) store.entries.delete(key);
  });
  if (!hit) return value;
  // Data lama hanya dipakai kalau memang sudah selesai dimuat; kalau masih jalan/gagal, tunggu yang baru.
  return hit.value.then((v) => v as T, () => value);
}

export function invalidateData(): void {
  store.entries.clear();
}

// Setelah server action mengubah data: kosongkan cache data lalu render ulang halaman.
export function refreshAll(): void {
  invalidateData();
  revalidatePath("/", "layout");
}
