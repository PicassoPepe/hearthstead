import { redirect } from "next/navigation";
import { requirePortal } from "@/server/portal/context";
import { portalHome } from "@/server/portal/queries";
import { RequestForm } from "@/components/portal/request-form";

export const metadata = { title: "New maintenance request" };

export default async function NewRequestPage() {
  const ctx = await requirePortal();
  const h = await portalHome(ctx);
  if (!h?.settings.allowRequests || ctx.preview) redirect("/portal/tenant/requests");
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">New maintenance request</h1>
      <RequestForm />
    </div>
  );
}
