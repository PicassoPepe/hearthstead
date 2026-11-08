"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, KeyRound, Plus, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createApiKeyAction, deleteWebhookAction, retryDeliveryAction, revealWebhookSecretAction, revokeApiKeyAction, sandboxAction, saveWebhookAction, testWebhookAction } from "@/server/actions/platform";

const copy = async (s: string) => { await navigator.clipboard.writeText(s).catch(() => undefined); toast.success("Copied"); };

export function ApiKeys({ keys, hasSandbox }: { keys: { id: string; name: string; prefix: string; scope: string; environment: string; lastUsedAt: string | null; createdAt: string }[]; hasSandbox: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ name: "", scope: "read" as "read" | "write", environment: "live" as "live" | "test" });
  const [created, setCreated] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => { setOpen(true); setCreated(null); }}><KeyRound aria-hidden /> Create API key</Button>
        <Button variant="secondary" onClick={async () => { const r = await sandboxAction(hasSandbox); if (!r.ok) return void toast.error(r.error); toast.success(r.message); router.refresh(); }}>{hasSandbox ? "Reset sandbox data" : "Create sandbox"}</Button>
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">API keys</caption>
        <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-1.5">Name</th><th scope="col">Key</th><th scope="col">Access</th><th scope="col">Last used</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k.id} className="border-t border-border">
              <td className="py-2 font-medium">{k.name}</td>
              <td><code className="text-xs">{k.prefix}_••••</code> {k.environment === "test" ? <Badge tone="warning">Sandbox</Badge> : <Badge tone="success">Live</Badge>}</td>
              <td>{k.scope === "write" ? "Read & write" : "Read only"}</td>
              <td className="text-muted-foreground">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}</td>
              <td className="text-right"><Button size="sm" variant="ghost" aria-label={`Revoke ${k.name}`} onClick={async () => { if (!window.confirm(`Revoke "${k.name}"? Apps using it stop working immediately.`)) return; const r = await revokeApiKeyAction(k.id); if (!r.ok) return void toast.error(r.error); toast.success(r.message); router.refresh(); }}>Revoke</Button></td>
            </tr>
          ))}
          {!keys.length ? <tr><td colSpan={5} className="py-4 text-muted-foreground">No API keys yet.</td></tr> : null}
        </tbody>
      </table>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{created ? "Copy your API key" : "Create API key"}</DialogTitle><DialogDescription>{created ? "This is the only time the full key is shown. Store it somewhere safe." : "Keys authenticate requests to the REST API."}</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-3">
            {created ? (
              <div className="flex items-center gap-2"><code className="flex-1 break-all rounded bg-surface-muted p-2 text-xs" data-testid="new-api-key">{created}</code><Button size="icon-sm" variant="secondary" aria-label="Copy key" onClick={() => copy(created)}><Copy aria-hidden /></Button></div>
            ) : (
              <>
                <Field label="Name" required>{(a) => <Input {...a} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Zapier, website" />}</Field>
                <Field label="Access">{(a) => <NativeSelect {...a} value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value as "read" })}><option value="read">Read only</option><option value="write">Read & write</option></NativeSelect>}</Field>
                <Field label="Environment" description={hasSandbox ? undefined : "Create the sandbox first to use test keys."}>{(a) => <NativeSelect {...a} value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value as "live" })}><option value="live">Live data</option><option value="test" disabled={!hasSandbox}>Sandbox (test)</option></NativeSelect>}</Field>
              </>
            )}
          </DialogBody>
          <DialogFooter>
            {created ? <Button onClick={() => setOpen(false)}>Done</Button> : (
              <>
                <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
                <Button loading={busy} onClick={async () => { setBusy(true); const r = await createApiKeyAction(f); setBusy(false); if (!r.ok) return void toast.error(r.error); setCreated(r.data.key); router.refresh(); }}>Create key</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type Endpoint = { id: string; url: string; description: string | null; events: string[]; active: boolean };
type Delivery = { id: string; event: string; status: string; attempts: number; responseStatus: number | null; lastError: string | null; createdAt: string; endpointUrl: string };

export function Webhooks({ endpoints, deliveries, events }: { endpoints: Endpoint[]; deliveries: Delivery[]; events: { key: string; label: string }[] }) {
  const router = useRouter();
  const [edit, setEdit] = React.useState<Endpoint | "new" | null>(null);
  const [f, setF] = React.useState({ url: "", description: "", events: [] as string[], active: true });
  const [secret, setSecret] = React.useState<{ id: string; value: string } | null>(null);
  React.useEffect(() => { if (edit && edit !== "new") setF({ url: edit.url, description: edit.description ?? "", events: edit.events, active: edit.active }); else if (edit === "new") setF({ url: "", description: "", events: ["lease.created", "payment.succeeded"], active: true }); }, [edit]);
  const run = async (p: Promise<{ ok: boolean; error?: string; message?: string }>, ok?: string) => { const r = await p; if (!r.ok) return void toast.error(r.error); toast.success(ok ?? r.message ?? "Done"); router.refresh(); };
  return (
    <div className="grid gap-4">
      <div><Button onClick={() => setEdit("new")}><Plus aria-hidden /> Add endpoint</Button></div>
      <ul className="grid gap-2">
        {endpoints.map((e) => (
          <li key={e.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all font-medium">{e.url}</code>{e.active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Paused</Badge>}
              <span className="ml-auto flex flex-wrap gap-1">
                <Button size="sm" variant="secondary" onClick={() => run(testWebhookAction(e.id), "Test event sent")} aria-label={`Send test event to ${e.url}`}><Send aria-hidden /> Test</Button>
                <Button size="sm" variant="ghost" onClick={async () => { const r = await revealWebhookSecretAction(e.id); if (r.ok) setSecret({ id: e.id, value: r.data }); }}>Signing secret</Button>
                <Button size="sm" variant="ghost" onClick={() => setEdit(e)}>Edit</Button>
                <Button size="sm" variant="ghost" onClick={() => { if (window.confirm("Delete this endpoint?")) void run(deleteWebhookAction(e.id)); }}>Delete</Button>
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{e.events.join(", ")}{e.description ? ` · ${e.description}` : ""}</p>
            {secret?.id === e.id ? <p className="mt-2 flex items-center gap-2"><code className="break-all rounded bg-surface-muted px-2 py-1 text-xs">{secret.value}</code><Button size="icon-sm" variant="secondary" aria-label="Copy secret" onClick={() => copy(secret.value)}><Copy aria-hidden /></Button></p> : null}
          </li>
        ))}
        {!endpoints.length ? <li className="text-sm text-muted-foreground">No endpoints yet. We POST a signed JSON event to your URL and retry with backoff (1m, 5m, 30m, 2h, 12h) until it returns 2xx.</li> : null}
      </ul>
      <section aria-labelledby="deliveries-h">
        <h3 id="deliveries-h" className="mb-2 font-medium">Recent deliveries</h3>
        <table className="w-full text-sm">
          <caption className="sr-only">Webhook deliveries</caption>
          <thead className="text-left text-xs text-muted-foreground"><tr><th scope="col" className="py-1.5">When</th><th scope="col">Event</th><th scope="col">Endpoint</th><th scope="col">Result</th><th scope="col"><span className="sr-only">Retry</span></th></tr></thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id} className="border-t border-border">
                <td className="py-1.5">{new Date(d.createdAt).toLocaleString()}</td>
                <td><code className="text-xs">{d.event}</code></td>
                <td className="max-w-48 truncate text-xs">{d.endpointUrl}</td>
                <td>{d.status === "SUCCEEDED" ? <Badge tone="success">{d.responseStatus ?? 200}</Badge> : <Badge tone={d.status === "DEAD" ? "danger" : "warning"}>{d.status === "DEAD" ? "Gave up" : d.status === "PENDING" ? "Pending" : "Retrying"}{d.lastError ? ` · ${d.lastError}` : ""}</Badge>} <span className="text-xs text-muted-foreground">{d.attempts} attempt{d.attempts === 1 ? "" : "s"}</span></td>
                <td className="text-right">{d.status !== "SUCCEEDED" ? <Button size="sm" variant="ghost" onClick={() => run(retryDeliveryAction(d.id))} aria-label={`Retry ${d.event}`}><RotateCcw aria-hidden /> Retry</Button> : null}</td>
              </tr>
            ))}
            {!deliveries.length ? <tr><td colSpan={5} className="py-3 text-muted-foreground">No deliveries yet.</td></tr> : null}
          </tbody>
        </table>
      </section>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{edit === "new" ? "Add webhook endpoint" : "Edit endpoint"}</DialogTitle><DialogDescription>Verify each request with the signing secret: <code>DeedWood-Signature: t=…,v1=HMAC-SHA256(secret, t + &quot;.&quot; + body)</code></DialogDescription></DialogHeader>
          <DialogBody className="grid gap-3">
            <Field label="Endpoint URL" required>{(a) => <Input {...a} type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://example.com/webhooks/deedwood" />}</Field>
            <Field label="Description">{(a) => <Input {...a} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
            <fieldset><legend className="mb-1.5 text-sm font-medium">Events</legend>
              <div className="grid gap-1 sm:grid-cols-2">{events.map((ev) => <label key={ev.key} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={f.events.includes(ev.key)} onChange={(e) => setF({ ...f, events: e.target.checked ? [...f.events, ev.key] : f.events.filter((x) => x !== ev.key) })} /><code className="text-xs">{ev.key}</code></label>)}</div>
            </fieldset>
            <label className="flex items-center gap-3 text-sm"><Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} aria-label="Active" /> Active</label>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
            <Button onClick={async () => { const r = await saveWebhookAction(edit === "new" ? null : (edit as Endpoint).id, f); if (!r.ok) return void toast.error(r.error); toast.success(r.message); setEdit(null); router.refresh(); }}>Save endpoint</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ExportForm({ today }: { today: string }) {
  const [from, setFrom] = React.useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = React.useState(today);
  const [format, setFormat] = React.useState("csv");
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Field label="From">{(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
      <Field label="To">{(a) => <Input {...a} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
      <Field label="Format">{(a) => <NativeSelect {...a} value={format} onChange={(e) => setFormat(e.target.value)}><option value="csv">QuickBooks journal CSV</option><option value="quickbooks">QuickBooks Online (JSON payload)</option></NativeSelect>}</Field>
      <Button asChild variant="secondary"><a href={`/api/exports/journal?from=${from}&to=${to}&format=${format}`}>Download</a></Button>
    </div>
  );
}
