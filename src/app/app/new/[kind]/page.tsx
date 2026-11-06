import { notFound } from "next/navigation";
import { createItem } from "@/lib/nav";
import { requireContext } from "@/server/context";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CreateBody } from "@/components/create/create-body";

/** Full-page fallback when /app/new/[kind] is loaded directly (deep link / refresh). */
export default async function CreatePage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const item = createItem(kind);
  if (!item) notFound();
  const ctx = await requireContext();
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={`New ${item.label.toLowerCase()}`} />
      <Card>
        <CardContent className="pt-5">
          <CreateBody kind={item.kind} ctx={ctx} mode="page" />
        </CardContent>
      </Card>
    </div>
  );
}
