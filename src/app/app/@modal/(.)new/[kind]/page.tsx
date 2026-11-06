import { notFound } from "next/navigation";
import { createItem } from "@/lib/nav";
import { requireContext } from "@/server/context";
import { CreateModal } from "@/components/create/create-modal";
import { CreateBody } from "@/components/create/create-body";

/** Intercepted route: /app/new/[kind] opened from within the app renders as a modal. */
export default async function InterceptedCreate({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { kind } = await params;
  const query = await searchParams;
  const item = createItem(kind);
  if (!item) notFound();
  const ctx = await requireContext();
  return (
    <CreateModal title={`New ${item.label.toLowerCase()}`} size={item.kind === "property" ? "wizard" : "default"}>
      <CreateBody kind={item.kind} ctx={ctx} mode="modal" query={query} />
    </CreateModal>
  );
}
