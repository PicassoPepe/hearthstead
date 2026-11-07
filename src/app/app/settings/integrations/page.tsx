import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { adminDb } from "@/server/db";
import { PageHeader } from "@/components/patterns/page-header";
import { Forbidden } from "@/components/patterns/forbidden";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiKeys, ExportForm, Webhooks } from "@/components/platform/integrations";
import { EVENT_TYPES, EVENT_LABEL } from "@/server/platform/events";
import { API_OPERATIONS } from "@/server/api/openapi";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await requireContext();
  if (!can(ctx.permissions, "settings", "edit")) return <Forbidden what="integrations" />;
  const [keys, org, endpoints, deliveries] = await Promise.all([
    ctx.db.apiKey.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "desc" } }),
    adminDb.organization.findUniqueOrThrow({ where: { id: ctx.org.id } }),
    ctx.db.webhookEndpoint.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } }),
    ctx.db.webhookDelivery.findMany({ orderBy: { createdAt: "desc" }, take: 25, include: { endpoint: { select: { url: true } } } }),
  ]);
  const base = process.env.AUTH_URL ?? "http://localhost:3000";
  return (
    <div className="grid max-w-5xl gap-4">
      <PageHeader eyebrow="Settings" title="Integrations" description="REST API keys, a sandbox to build against, signed webhooks, and accounting exports." />
      <Card>
        <CardHeader><div><CardTitle>API keys</CardTitle><CardDescription>Use <code>Authorization: Bearer &lt;key&gt;</code> against <code>{base}/api/v1</code>. Test keys act on your sandbox, a separate copy with sample data{org.sandboxOrgId ? "" : " (not created yet)"}.</CardDescription></div></CardHeader>
        <CardContent><ApiKeys hasSandbox={Boolean(org.sandboxOrgId)} keys={keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scope: k.scope, environment: k.environment, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() }))} /></CardContent>
      </Card>
      <Card>
        <CardHeader><div><CardTitle>API reference</CardTitle><CardDescription>OpenAPI 3.1: <a className="text-primary hover:underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">/api/v1/openapi.json</a> — import it into Postman, Insomnia or a code generator. Cursor pagination, 120 requests/minute per key, and <code>Idempotency-Key</code> on writes.</CardDescription></div></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <caption className="sr-only">Endpoints</caption>
            <tbody>{API_OPERATIONS.map((o) => <tr key={o.method + o.path} className="border-t border-border first:border-0"><td className="w-20 py-1.5"><code className={`text-xs font-semibold ${o.method === "GET" ? "text-info" : "text-success"}`}>{o.method}</code></td><td><code className="text-xs">/api/v1{o.path}</code></td><td className="text-muted-foreground">{o.summary}</td></tr>)}</tbody>
          </table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><div><CardTitle>Webhooks</CardTitle><CardDescription>Get notified when things happen: {EVENT_TYPES.join(", ")}.</CardDescription></div></CardHeader>
        <CardContent>
          <Webhooks events={EVENT_TYPES.map((e) => ({ key: e, label: EVENT_LABEL[e] }))} endpoints={endpoints.map((e) => ({ id: e.id, url: e.url, description: e.description, events: e.events, active: e.active }))} deliveries={deliveries.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, responseStatus: d.responseStatus, lastError: d.lastError, createdAt: d.createdAt.toISOString(), endpointUrl: d.endpoint.url }))} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><div><CardTitle>Accounting export</CardTitle><CardDescription>Export the general ledger for QuickBooks (journal-entry import CSV, or a QuickBooks Online API payload). Properties export as classes.</CardDescription></div></CardHeader>
        <CardContent><ExportForm today={new Date().toISOString().slice(0, 10)} /></CardContent>
      </Card>
    </div>
  );
}
