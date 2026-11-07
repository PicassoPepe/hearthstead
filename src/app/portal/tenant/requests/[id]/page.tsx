import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { requirePortal } from "@/server/portal/context";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/patterns/status-badge";
import { RequestReply } from "@/components/portal/request-reply";
import { PUBLIC_STATUS_TEXT, categoryLabel } from "@/lib/maintenance";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Request" };
const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STEPS = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"] as const;

export default async function RequestDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePortal();
  const t = await ctx.db.task.findFirst({
    where: { id, tenantId: ctx.tenant.id, type: "TENANT_REQUEST" },
    include: { activities: { where: { public: true }, orderBy: { createdAt: "asc" } } },
  });
  if (!t) notFound();
  const photos = await ctx.db.attachment.findMany({ where: { entityType: "Task", entityId: t.id } });
  const reached = STEPS.indexOf(t.status === "WAITING" ? "IN_PROGRESS" : t.status === "ARCHIVED" ? "COMPLETED" : (t.status as (typeof STEPS)[number]));
  return (
    <div className="grid gap-4">
      <Link href="/portal/tenant/requests" className="text-sm font-medium text-primary underline-offset-4 hover:underline">← All requests</Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-sm text-muted-foreground">#{t.number} · {categoryLabel(t.category)} · submitted {formatDate(t.createdAt)}</p>
      </div>
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Status</h2>
          <StatusBadge status={t.status} label={PUBLIC_STATUS_TEXT[t.status]} />
        </div>
        <ol className="grid grid-cols-3 gap-2 text-center text-xs" aria-label="Progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-col items-center gap-1">
              {i <= reached ? <CheckCircle2 className="size-6 text-primary" aria-hidden /> : <Circle className="size-6 text-muted-foreground" aria-hidden />}
              <span className={i <= reached ? "font-medium" : "text-muted-foreground"}>{PUBLIC_STATUS_TEXT[s]}</span>
              <span className="sr-only">{i <= reached ? "(done)" : "(not yet)"}</span>
            </li>
          ))}
        </ol>
      </Card>
      {t.description ? <Card className="whitespace-pre-wrap p-4 text-sm">{t.description}</Card> : null}
      {photos.length ? (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((p) => (
            // eslint-disable-next-line @next/next/no-img-element -- authenticated, tenant-scoped image route
            <a key={p.id} href={`/api/portal/files/${p.id}`} target="_blank" rel="noopener"><img src={`/api/portal/files/${p.id}`} alt={`Photo: ${p.name}`} className="aspect-square w-full rounded-lg border border-border object-cover" /></a>
          ))}
        </div>
      ) : null}
      <section aria-labelledby="updates-h">
        <h2 id="updates-h" className="mb-2 font-semibold">Updates</h2>
        <ol className="relative space-y-3 border-l border-border pl-5">
          {t.activities.map((a) => (
            <li key={a.id} className="relative text-sm">
              <span aria-hidden className="absolute -left-[26px] top-1 size-3 rounded-full border-2 border-surface bg-primary" />
              <div className={a.kind === "COMMENT" ? "rounded-lg bg-surface-muted px-3 py-2" : ""}>{a.body}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{fmt.format(a.createdAt)} · {a.actorName ?? ctx.org.name}</div>
            </li>
          ))}
        </ol>
      </section>
      {!ctx.preview && t.status !== "ARCHIVED" ? <RequestReply taskId={t.id} /> : null}
    </div>
  );
}
