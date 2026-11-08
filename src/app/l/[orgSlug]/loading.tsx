import { PageSkeleton } from "@/components/patterns/page-skeleton";

export default function Loading() {
  return <main className="portal-density mx-auto max-w-5xl px-4 py-8"><PageSkeleton variant="portal" /></main>;
}
