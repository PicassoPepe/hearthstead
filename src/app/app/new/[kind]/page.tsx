import { notFound } from "next/navigation";
import { createItem, createTitle } from "@/lib/nav";
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
    <div className={["property", "lease", "journal-entry"].includes(item.kind) ? "mx-auto max-w-3xl" : "mx-auto max-w-2xl"}>
      <PageHeader title={createTitle(item)} />
      <Card className={["property", "lease"].includes(item.kind) ? "flex min-h-[600px] flex-col overflow-hidden" : undefined}>
        {["property", "lease"].includes(item.kind) ? (
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
