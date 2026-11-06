import { notFound } from "next/navigation";
import { createItem } from "@/lib/nav";
import { requireContext } from "@/server/context";
import { PageHeader } from "@/components/patterns/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { CreateBody } from "@/components/create/create-body";

/** Full-page fallback when /app/new/[kind] is loaded directly (deep link / refresh). */
export default async function CreatePage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { kind } = await params;
  const query = await searchParams;
  const item = createItem(kind);
  if (!item) notFound();
  const ctx = await requireContext();
  return (
    <div className={item.kind === "property" ? "mx-auto max-w-3xl" : "mx-auto max-w-2xl"}>
      <PageHeader title={`New ${item.label.toLowerCase()}`} />
      <Card className={item.kind === "property" ? "flex min-h-[600px] flex-col overflow-hidden" : undefined}>
        {item.kind === "property" ? (
          <CreateBody kind={item.kind} ctx={ctx} mode="page" query={query} />
        ) : (
          <CardContent className="pt-5">
            <CreateBody kind={item.kind} ctx={ctx} mode="page" query={query} />
          </CardContent>
        )}
      </Card>
    </div>
  );
}
