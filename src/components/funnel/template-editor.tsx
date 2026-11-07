"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { MERGE_FIELDS, renderTemplate } from "@/lib/templates";
import { deleteTemplateAction, saveTemplateAction } from "@/server/actions/funnel";

type T = { id: string; name: string; kind: string; body: string };
const KINDS = [["LEASE", "Lease"], ["RENEWAL", "Renewal"], ["NOTICE", "Notice"], ["ADVERSE_ACTION", "Adverse action"], ["OTHER", "Other"]] as const;

export function TemplateEditor({ templates, canEdit }: { templates: T[]; canEdit: boolean }) {
  const router = useRouter();
  const [sel, setSel] = React.useState<string>(templates[0]?.id ?? "new");
  const current = templates.find((t) => t.id === sel);
  const [f, setF] = React.useState<Omit<T, "id">>(current ?? { name: "", kind: "OTHER", body: "" });
  const [busy, setBusy] = React.useState(false);
  const area = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => { const t = templates.find((x) => x.id === sel); setF(t ?? { name: "", kind: "OTHER", body: "" }); }, [sel, templates]);
  const preview = renderTemplate(f.body, Object.fromEntries(MERGE_FIELDS.map((m) => [m.key, m.sample])));
  const insert = (k: string) => {
    const el = area.current;
    const tag = `{{${k}}}`;
    if (!el) return setF({ ...f, body: f.body + tag });
    const [a, b] = [el.selectionStart, el.selectionEnd];
    setF({ ...f, body: f.body.slice(0, a) + tag + f.body.slice(b) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); });
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <nav aria-label="Templates" className="grid content-start gap-1">
        {templates.map((t) => <button key={t.id} type="button" aria-current={sel === t.id ? "true" : undefined} onClick={() => setSel(t.id)} className={`rounded-lg px-3 py-2 text-left text-sm ${sel === t.id ? "bg-primary-soft font-medium text-primary-soft-foreground" : "hover:bg-surface-muted"}`}>{t.name}<span className="block text-xs text-muted-foreground">{KINDS.find((k) => k[0] === t.kind)?.[1]}</span></button>)}
        {canEdit ? <Button variant="secondary" size="sm" onClick={() => setSel("new")}>New template</Button> : null}
      </nav>
      <div className="grid gap-4 xl:grid-cols-2">
        <div className="grid content-start gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" required>{(a) => <Input {...a} value={f.name} disabled={!canEdit} onChange={(e) => setF({ ...f, name: e.target.value })} />}</Field>
            <Field label="Used for">{(a) => <NativeSelect {...a} value={f.kind} disabled={!canEdit} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>}</Field>
          </div>
          <Field label="Template" description="# Heading, **bold**, blank line between paragraphs, - for lists. Insert merge fields below.">{(a) => <Textarea {...a} ref={area} rows={18} className="font-mono text-xs" value={f.body} disabled={!canEdit} onChange={(e) => setF({ ...f, body: e.target.value })} />}</Field>
          {canEdit ? (
            <details className="rounded-lg border border-border p-2 text-sm" open>
              <summary className="cursor-pointer font-medium">Merge fields</summary>
              <div className="mt-2 flex flex-wrap gap-1">{MERGE_FIELDS.map((m) => <button key={m.key} type="button" onClick={() => insert(m.key)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-surface-muted" title={m.label}>{`{{${m.key}}}`}</button>)}</div>
            </details>
          ) : null}
          {canEdit ? (
            <div className="flex gap-2">
              <Button loading={busy} onClick={async () => {
                setBusy(true);
                const r = await saveTemplateAction(sel === "new" ? null : sel, f as { name: string; kind: "OTHER"; body: string });
                setBusy(false);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Template saved");
                router.refresh();
                setSel(r.data.id);
              }}>Save template</Button>
              {sel !== "new" ? <Button variant="ghost" onClick={async () => { const r = await deleteTemplateAction(sel); if (!r.ok) return void toast.error(r.error); toast.success("Deleted"); setSel(templates.find((t) => t.id !== sel)?.id ?? "new"); router.refresh(); }}>Delete</Button> : null}
            </div>
          ) : null}
        </div>
        <section aria-label="Preview with sample data" className="rounded-card border border-border bg-surface p-5 shadow-card">
          <p className="mb-3 text-xs font-medium text-muted-foreground">Preview with sample data{preview.missing.length ? ` · unknown fields: ${preview.missing.join(", ")}` : ""}</p>
          <div className="prose-doc text-sm leading-relaxed [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:mb-2" dangerouslySetInnerHTML={{ __html: preview.html }} />
        </section>
      </div>
    </div>
  );
}
