import { Hammer } from "lucide-react";
import { EmptyState } from "./empty-state";
import { PageHeader } from "./page-header";

/** Placeholder for sections that land in a later build phase. */
export function ComingSoon({ title, phase, description }: { title: string; phase: number; description: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState icon={<Hammer />} title={`${title} arrives in Phase ${phase}`} description={description} />
    </>
  );
}
