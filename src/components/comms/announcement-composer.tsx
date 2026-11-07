"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Megaphone, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { cancelAnnouncementAction, improveTextAction, previewAudienceAction, saveAnnouncementAction } from "@/server/actions/comms";

type AudienceType = "ALL_TENANTS" | "PROPERTY_TENANTS" | "ALL_OWNERS" | "PROPERTY_OWNERS";
const CHANNELS = [["PORTAL", "Portal"], ["EMAIL", "Email"], ["SMS", "SMS"]] as const;

export function AnnouncementComposer({ properties, smsEnabled }: { properties: { id: string; name: string }[]; smsEnabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [body, setBody] = React.useState("");
  const [type, setType] = React.useState<AudienceType>("ALL_TENANTS");
  const [props, setProps] = React.useState<string[]>([]);
  const [channels, setChannels] = React.useState<string[]>(["PORTAL", "EMAIL"]);
  const [when, setWhen] = React.useState("");
  const [preview, setPreview] = React.useState<{ count: number; email: number; sms: number; sample: string[] } | null>(null);
  const [busy, setBusy] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    let live = true;
    void previewAudienceAction({ type, propertyIds: props }).then((r) => live && r.ok && setPreview(r.data));
    return () => { live = false; };
  }, [open, type, props]);

  if (!open) return <Button onClick={() => setOpen(true)}><Megaphone aria-hidden /> New announcement</Button>;

  const submit = async (mode: "draft" | "schedule" | "send") => {
    setBusy(mode);
    const r = await saveAnnouncementAction(null, { title, body, audience: { type, propertyIds: type.startsWith("PROPERTY_") ? props : [] }, channels: channels as ("PORTAL" | "EMAIL" | "SMS")[], scheduledFor: when ? new Date(when).toISOString() : null }, mode);
    setBusy("");
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
    toast.success(mode === "send" ? `Announcement sent — ${r.data.sent} delivered${r.data.skipped ? `, ${r.data.skipped} skipped` : ""}${r.data.failed ? `, ${r.data.failed} failed` : ""}` : mode === "schedule" ? "Announcement scheduled" : "Draft saved");
    setOpen(false);
    setTitle(""); setBody(""); setWhen(""); setErrors({});
    router.refresh();
  };

  return (
    <section aria-labelledby="compose-h" className="grid gap-4 rounded-card border border-border bg-surface p-4 shadow-card">
      <h2 id="compose-h" className="font-semibold">New announcement</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Audience" required>{(a) => (
          <NativeSelect {...a} value={type} onChange={(e) => setType(e.target.value as AudienceType)}>
            <option value="ALL_TENANTS">All current tenants</option>
            <option value="PROPERTY_TENANTS">Tenants at selected properties</option>
            <option value="ALL_OWNERS">All owners</option>
            <option value="PROPERTY_OWNERS">Owners of selected properties</option>
          </NativeSelect>
        )}</Field>
        <fieldset className="grid gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">Channels</legend>
          <div className="flex flex-wrap gap-4">
            {CHANNELS.map(([v, l]) => (
              <label key={v} className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" disabled={v === "SMS" && !smsEnabled} checked={channels.includes(v)} onChange={(e) => setChannels(e.target.checked ? [...channels, v] : channels.filter((c) => c !== v))} />
                {l}{v === "SMS" && !smsEnabled ? " (off)" : ""}
              </label>
            ))}
          </div>
          {errors.channels ? <p className="text-sm text-danger">{errors.channels}</p> : null}
        </fieldset>
        {type.startsWith("PROPERTY_") ? (
          <fieldset className="md:col-span-2">
            <legend className="mb-1.5 text-sm font-medium">Properties</legend>
            <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2 lg:grid-cols-3">
              {properties.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={props.includes(p.id)} onChange={(e) => setProps(e.target.checked ? [...props, p.id] : props.filter((x) => x !== p.id))} /> {p.name}</label>
              ))}
            </div>
          </fieldset>
        ) : null}
        <Field label="Title" required error={errors.title} className="md:col-span-2">{(a) => <Input {...a} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Water shutoff on Tuesday" />}</Field>
        <div className="md:col-span-2">
          <Field label="Message" required error={errors.body}>{(a) => <Textarea {...a} rows={5} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="secondary" disabled={!body.trim()} loading={busy === "improve"} onClick={async () => {
              setBusy("improve");
              const r = await improveTextAction(body, "announcement");
              setBusy("");
              if (!r.ok) return void toast.error(r.error);
              setBody(r.data);
              toast.success("Rewritten — review before sending");
            }}><Wand2 aria-hidden /> Improve with AI</Button>
            {channels.includes("SMS") ? <span className="text-xs text-muted-foreground">SMS: {`${title}: ${body}`.length} chars · ~{Math.max(1, Math.ceil(`${title}: ${body}`.length / 153))} segment(s) per recipient</span> : null}
          </div>
        </div>
        <Field label="Schedule (optional)" description="Leave empty to send now" error={errors.scheduledFor}>{(a) => <Input {...a} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
        <div aria-live="polite" className="self-end rounded-lg bg-surface-muted/60 p-3 text-sm">
          {preview ? <>Reaches <strong>{preview.count}</strong> {type.includes("OWNER") ? "owners" : "tenants"} · {preview.email} with email · {preview.sms} with a mobile number{preview.sample.length ? <span className="block text-xs text-muted-foreground">e.g. {preview.sample.join(", ")}</span> : null}</> : "Counting recipients…"}
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
        <Button variant="secondary" loading={busy === "draft"} onClick={() => submit("draft")}>Save draft</Button>
        {when ? <Button loading={busy === "schedule"} onClick={() => submit("schedule")}>Schedule</Button> : <Button loading={busy === "send"} onClick={() => submit("send")}>Send now</Button>}
      </div>
    </section>
  );
}

export function CancelAnnouncementButton({ id }: { id: string }) {
  const router = useRouter();
  return <Button size="sm" variant="ghost" onClick={async () => { const r = await cancelAnnouncementAction(id); if (!r.ok) return void toast.error(r.error); toast.success("Canceled"); router.refresh(); }}>Cancel</Button>;
}
