import Link from "next/link";
import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CreateCompanyForm } from "@/components/admin/create-company-form";

export const metadata = { title: "Companies" };

export default async function AdminOrgs({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const p = await requirePlatformPage();
  const q = (await searchParams).q?.trim() ?? "";
  const orgs = await adminDb.organization.findMany({
    where: { deletedAt: null, isSandbox: false, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { slug: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { _count: { select: { memberships: { where: { deletedAt: null } } } } },
  });
  const units = await adminDb.unit.groupBy({ by: ["organizationId"], where: { deletedAt: null, organizationId: { in: orgs.map((o) => o.id) } }, _count: true });
  const unitsBy = new Map(units.map((u) => [u.organizationId, u._count]));
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Companies</h1>
      {p.role === "OWNER" ? <CreateCompanyForm /> : null}
      <form className="flex max-w-md gap-2"><Input name="q" defaultValue={q} placeholder="Search by name, web name or email" aria-label="Search companies" /><Button type="submit">Search</Button></form>
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">Companies</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["Company", "Staff", "Units", "Started", "Status"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="px-3 py-2"><Link href={`/admin/orgs/${o.id}`} className="font-medium text-primary hover:underline">{o.name}</Link><div className="text-xs text-muted-foreground">{o.slug}</div></td>
                <td className="px-3 py-2 tabular">{o._count.memberships}</td>
                <td className="px-3 py-2 tabular">{unitsBy.get(o.id) ?? 0}</td>
                <td className="px-3 py-2">{o.createdAt.toISOString().slice(0, 10)}</td>
                <td className="px-3 py-2">{o.suspendedAt ? <Badge tone="danger">Paused</Badge> : <Badge tone="success">Active</Badge>}</td>
              </tr>
            ))}
            {!orgs.length ? <tr><td colSpan={5} className="px-3 py-8 text-center text-muted-foreground">No companies found.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
