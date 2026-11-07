import { requireOwnerPortal } from "@/server/portal/owner-context";
import { portalThread } from "@/server/comms/portal-queries";
import { PortalThread } from "@/components/portal/portal-thread";
import { sendOwnerMessage } from "@/server/actions/owner-portal";

export const metadata = { title: "Messages" };

export default async function OwnerMessages() {
  const o = await requireOwnerPortal();
  const messages = await portalThread(o.db, { ownerId: o.owner.id }, true);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
      <PortalThread messages={messages} send={sendOwnerMessage} orgName={o.org.name} />
    </div>
  );
}
