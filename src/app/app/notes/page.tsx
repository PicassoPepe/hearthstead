import { StickyNote as StickyNoteIcon } from "lucide-react";
import Link from "next/link";
import { StickyNote } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { adminDb } from "@/server/db";
import { entityHref } from "@/server/records/queries";
import { PageHeader } from "@/components/patterns/page-header";
import { EmptyState } from "@/components/patterns/empty-state";
import { Card } from "@/components/ui/card";
import { ENTITY_MODULE, isEntityType } from "@/server/records/service";

export const metadata = { title: "Notes" };
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });

/** All notes across records the user can see, newest first. */
export default async function NotesPage() {
  const ctx = await requireContext();
  const visibleTypes = Object.keys(ENTITY_MODULE).filter((t) => isEntityType(t) && can(ctx.permissions, ENTITY_MODULE[t], "view"));
  const notes = await ctx.db.note.findMany({ where: { entityType: { in: visibleTypes } }, orderBy: { createdAt: "desc" }, take: 200 });
  const [props, units, owners, users] = await Promise.all([
    ctx.db.property.findMany({ where: { id: { in: notes.filter((n) => n.entityType === "Property").map((n) => n.entityId) } }, select: { id: true, name: true } }),
    ctx.db.unit.findMany({ where: { id: { in: notes.filter((n) => n.entityType === "Unit").map((n) => n.entityId) } }, select: { id: true, name: true, property: { select: { name: true } } } }),
    ctx.db.owner.findMany({ where: { id: { in: notes.filter((n) => n.entityType === "Owner").map((n) => n.entityId) } } }),
    adminDb.user.findMany({ where: { id: { in: notes.map((n) => n.createdById ?? "") } }, select: { id: true, name: true, email: true } }),
  ]);
  const label = (t: string, id: string) =>
    t === "Property" ? props.find((p) => p.id === id)?.name
    : t === "Unit" ? (() => { const u = units.find((x) => x.id === id); return u ? `${u.property.name} · ${u.name}` : undefined; })()
    : t === "Owner" ? (() => { const o = owners.find((x) => x.id === id); return o ? (o.companyName ?? `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim()) : undefined; })()
    : undefined;

  return (
    <>
      <PageHeader icon={<StickyNoteIcon aria-hidden />} title="Notes" description="Notes from every property, unit and owner." />
      {notes.length === 0 ? (
        <EmptyState icon={<StickyNote />} title="No notes yet" description="Open any property, unit or owner and use the Notes tab to capture what your team should know." action={<Link href="/app/rentals" className="font-medium text-primary underline">Go to properties</Link>} />
      ) : (
        <ul className="grid gap-3">
          {notes.map((n) => {
            const name = label(n.entityType, n.entityId);
            if (!name) return null;
            const author = users.find((u) => u.id === n.createdById);
            return (
              <li key={n.id}>
                <Card className="p-4">
                  <div className="mb-1.5 text-xs text-muted-foreground">
                    <Link href={`${entityHref(n.entityType, n.entityId)}?tab=notes`} className="font-medium text-foreground hover:underline">{name}</Link>
                    {" · "}{n.entityType} · {author?.name ?? author?.email ?? "System"} · {fmt.format(n.createdAt)}
                  </div>
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
