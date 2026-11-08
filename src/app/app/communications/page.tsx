import { MessagesSquare as MessagesSquareIcon } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Inbox, type ContactOption } from "@/components/comms/inbox";
import { contactOf, smsUsage } from "@/server/comms/service";
import { tenantDisplayName } from "@/lib/leasing";

export const metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string; filter?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireContext();
  if (!can(ctx.permissions, "communications", "view")) return <Forbidden what="communications" />;
  const filter = sp.filter ?? "all";
  const where =
    filter === "unread" ? { unreadCount: { gt: 0 } } :
    filter === "closed" ? { status: "CLOSED" } :
    filter === "Tenant" ? { tenantId: { not: null }, status: "OPEN" } :
    filter === "Owner" ? { ownerId: { not: null }, status: "OPEN" } :
    filter === "Vendor" ? { vendorId: { not: null }, status: "OPEN" } : { status: "OPEN" };
  const [convs, usage, tenants, owners, vendors] = await Promise.all([
    ctx.db.conversation.findMany({ where, orderBy: { lastMessageAt: "desc" }, take: 200 }),
    smsUsage(ctx.db),
    ctx.db.tenant.findMany({ orderBy: [{ lastName: "asc" }, { firstName: "asc" }], select: { id: true, kind: true, firstName: true, lastName: true, companyName: true } }),
    ctx.db.owner.findMany({ orderBy: [{ lastName: "asc" }], select: { id: true, kind: true, firstName: true, lastName: true, companyName: true } }),
    ctx.db.vendor.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const tName = new Map(tenants.map((t) => [t.id, tenantDisplayName(t)]));
  const oName = new Map(owners.map((o) => [o.id, o.kind === "COMPANY" ? o.companyName ?? "" : [o.firstName, o.lastName].filter(Boolean).join(" ")]));
  const vName = new Map(vendors.map((v) => [v.id, v.name]));
  const rows = convs.map((c) => ({
    id: c.id,
    name: (c.tenantId && tName.get(c.tenantId)) || (c.ownerId && oName.get(c.ownerId)) || (c.vendorId && vName.get(c.vendorId)) || c.phone || "Unknown",
    kind: c.tenantId ? "Tenant" : c.ownerId ? "Owner" : c.vendorId ? "Vendor" : "Unknown number",
    preview: c.lastMessagePreview ?? "", at: c.lastMessageAt.toISOString(), unread: c.unreadCount, status: c.status,
  }));
  let thread = null;
  if (sp.c) {
    const conv = await ctx.db.conversation.findFirst({ where: { id: sp.c }, include: { messages: { orderBy: { createdAt: "asc" }, take: 300 } } });
    if (conv) {
      const contact = await contactOf(ctx.db, conv);
      const phone = contact.phone ?? conv.phone;
      thread = {
        id: conv.id, name: contact.name, kind: contact.kind, href: contact.href, email: contact.email, phone, status: conv.status,
        optedOut: phone ? Boolean(await ctx.db.smsOptOut.findFirst({ where: { phone } })) : false,
        messages: conv.messages.map((m) => ({ id: m.id, direction: m.direction, channel: m.channel, body: m.body, author: m.authorName, at: m.createdAt.toISOString(), status: m.status, error: m.error, aiDrafted: m.aiDrafted })),
      };
    }
  }
  const contacts: ContactOption[] = [
    ...tenants.map((t) => ({ value: `T:${t.id}`, label: tenantDisplayName(t), group: "Tenants" })),
    ...owners.map((o) => ({ value: `O:${o.id}`, label: oName.get(o.id) ?? "", group: "Owners" })),
    ...vendors.map((v) => ({ value: `V:${v.id}`, label: v.name, group: "Vendors" })),
  ];
  return (
    <>
      <PageHeader icon={<MessagesSquareIcon aria-hidden />} eyebrow="Communications" title="Inbox" description="Portal messages, texts and emails with tenants, owners and vendors — in one place." />
      <Inbox rows={rows} thread={thread} filter={filter} contacts={contacts} usage={usage} canEdit={can(ctx.permissions, "communications", "edit")} presetTo={sp.to} />
    </>
  );
}
