import Link from "next/link";
import { requirePortal } from "@/server/portal/context";
import { portalThread } from "@/server/comms/portal-queries";
import { PortalThread } from "@/components/portal/portal-thread";
import { sendPortalMessage } from "@/server/actions/portal";

export const metadata = { title: "Messages" };

export default async function TenantMessages() {
  const ctx = await requirePortal();
  const messages = await portalThread(ctx.db, { tenantId: ctx.tenant.id }, !ctx.preview);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
      <p className="text-muted-foreground">Questions for {ctx.org.name}? For repairs, use <Link className="text-primary underline" href="/portal/tenant/requests">Requests</Link> so we can track them.</p>
      <PortalThread messages={messages} send={sendPortalMessage} readOnly={ctx.preview} orgName={ctx.org.name} />
    </div>
  );
}
