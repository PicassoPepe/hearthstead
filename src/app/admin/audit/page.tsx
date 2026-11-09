import Link from "next/link";
import { requirePlatformPage } from "@/server/platform-admin/page";
import { adminDb } from "@/server/db";
import { cn } from "@/lib/utils";

export const metadata = { title: "Audit log" };

export default async function AdminAudit({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePlatformPage();
  const tab = (await searchParams).tab ?? "console";
  const [console_, viewAs, security] = await Promise.all([
    tab === "console" ? adminDb.platformAuditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }) : [],
    tab === "viewas" ? adminDb.auditLog.findMany({ where: { impersonatorId: { not: null } }, orderBy: { createdAt: "desc" }, take: 200, include: { organization: { select: { name: true } } } }) : [],
    tab === "security" ? adminDb.securityEvent.findMany({ orderBy: { createdAt: "desc" }, take: 200 }) : [],
  ]);
  const ids = [...new Set([...console_.map((c) => c.actorUserId), ...viewAs.map((v) => v.impersonatorId!), ...viewAs.map((v) => v.actorId ?? "")])];
  const people = new Map((await adminDb.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })).map((u) => [u.id, u.email]));
  const tabs = [["console", "Owner console changes"], ["viewas", "Changes made while viewing as someone"], ["security", "Sign-in problems"]];
  const t = (d: Date) => d.toISOString().slice(0, 16).replace("T", " ");
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-bold">Audit log</h1>
      <nav aria-label="Audit log" className="flex flex-wrap gap-1">{tabs.map(([id, label]) => <Link key={id} href={`?tab=${id}`} aria-current={tab === id ? "page" : undefined} className={cn("rounded-md px-3 py-1.5 text-sm", tab === id ? "bg-primary-soft font-semibold text-primary-soft-foreground" : "text-muted-foreground hover:bg-surface-muted")}>{label}</Link>)}</nav>
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-sm">
          <caption className="sr-only">{tabs.find((x) => x[0] === tab)?.[1]}</caption>
          {tab === "console" ? (
            <><thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["When (UTC)", "Who", "What", "To", "Reason"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{console_.map((r) => <tr key={r.id} className="border-t border-border"><td className="px-3 py-2 whitespace-nowrap">{t(r.createdAt)}</td><td className="px-3 py-2">{people.get(r.actorUserId) ?? r.actorUserId}</td><td className="px-3 py-2 font-medium">{r.action}</td><td className="px-3 py-2">{r.targetType}{r.targetId ? ` ${r.targetId}` : ""}</td><td className="px-3 py-2">{r.reason ?? "—"}</td></tr>)}</tbody></>
          ) : tab === "viewas" ? (
            <><thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["When (UTC)", "Owner", "Acting as", "Company", "What"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{viewAs.map((r) => <tr key={r.id} className="border-t border-border"><td className="px-3 py-2 whitespace-nowrap">{t(r.createdAt)}</td><td className="px-3 py-2">{people.get(r.impersonatorId!)}</td><td className="px-3 py-2">{people.get(r.actorId ?? "") ?? "—"}</td><td className="px-3 py-2">{r.organization.name}</td><td className="px-3 py-2 font-medium">{r.action} <span className="font-normal text-muted-foreground">{r.entityType}</span></td></tr>)}</tbody></>
          ) : (
            <><thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground"><tr>{["When (UTC)", "What", "Address", "Email fingerprint"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>{security.map((r) => <tr key={r.id} className="border-t border-border"><td className="px-3 py-2 whitespace-nowrap">{t(r.createdAt)}</td><td className="px-3 py-2 font-medium">{r.kind}</td><td className="px-3 py-2">{r.ip ?? "—"}</td><td className="px-3 py-2 font-mono text-xs">{r.emailHash?.slice(0, 12) ?? "—"}</td></tr>)}</tbody></>
          )}
        </table>
      </div>
    </div>
  );
}
