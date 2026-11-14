import { PageSkeleton } from "@/components/page-skeleton";

export default function Loading() {
  return <PageSkeleton kpis={0} filters={5} rows={12} cols={8} />;
}
