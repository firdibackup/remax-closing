import { PageSkeleton } from "@/components/page-skeleton";

// Input Genius: panel kiri (periode + Closing ID) dan pratinjau. Menarik dari Genius bisa lama.
export default function Loading() {
  return <PageSkeleton kpis={0} side rows={6} label="Menarik data…" />;
}
