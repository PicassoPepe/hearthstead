"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, ExternalLink, History, ImagePlus, Monitor, Palette, Plus, Smartphone, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BLOCK_LABELS, FONTS, TARGETS, newBlock, type Block, type BlockType, type SiteContent, type Target } from "@/lib/site/blocks";
import { TEMPLATES } from "@/lib/site/templates";
import { applySiteTemplateAction, publishSiteAction, restoreSiteVersionAction, saveSiteDraftAction, setSiteDomainAction, setSiteLiveAction, uploadSiteImageAction } from "@/server/actions/website";
import { cn } from "@/lib/utils";

type Props = { initial: SiteContent; orgSlug: string; publishedAt: string | null; live: boolean; customDomain: string | null; subdomainUrl: string | null; versions: { id: string; at: string; note: string | null; by: string }[]; changedSincePublish: boolean };

/** The website editor: sections on the left (switch on/off, reorder, edit), live preview on the right. */
export function WebsiteEditor(p: Props) {
  const router = useRouter();
  const [c, setC] = React.useState<SiteContent>(p.initial);
  const [saving, setSaving] = React.useState<"idle" | "saving" | "saved" | "error">("idle");
  const [dirtySincePublish, setDirtySincePublish] = React.useState(p.changedSincePublish);
  const [previewKey, setPreviewKey] = React.useState(0);
  const [device, setDevice] = React.useState<"desktop" | "phone">("desktop");
  const [tab, setTab] = React.useState<"sections" | "look">("sections");
  const [open, setOpen] = React.useState<string | null>(null);
  const first = React.useRef(true);

  // Save the draft a moment after each change, then refresh the preview.
  React.useEffect(() => {
    if (first.current) { first.current = false; return; }
    setSaving("saving");
    const t = setTimeout(async () => {
      const r = await saveSiteDraftAction(c);
      if (!r.ok) { setSaving("error"); return void toast.error(r.error); }
      setSaving("saved");
      setDirtySincePublish(true);
      setPreviewKey((k) => k + 1);
    }, 900);
    return () => clearTimeout(t);
  }, [c]);

  const setBlock = (id: string, patch: Partial<Block>) => setC({ ...c, sections: c.sections.map((s) => (s.id === id ? ({ ...s, ...patch } as Block) : s)) });
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= c.sections.length) return;
    const s = [...c.sections];
    [s[i], s[j]] = [s[j]!, s[i]!];
    setC({ ...c, sections: s });
  };
  const add = (t: BlockType) => { const b = newBlock(t); setC({ ...c, sections: [...c.sections, b] }); setOpen(b.id); };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded-card border border-border bg-surface p-3 shadow-card">
        <div className="mr-auto text-sm">
          <p className="font-semibold">{p.publishedAt ? (p.live ? "Your website is live" : "Your website is hidden") : "Not published yet"}</p>
          <p className="text-muted-foreground" aria-live="polite">{saving === "saving" ? "Saving…" : saving === "error" ? "Couldn't save — check the highlighted section" : dirtySincePublish ? "Changes saved as a draft — press Publish to show them to visitors" : "Visitors see what's here"}</p>
        </div>
        <Button variant="secondary" asChild><a href={`/s/${p.orgSlug}`} target="_blank" rel="noreferrer"><ExternalLink aria-hidden /> Open website</a></Button>
        <TemplatePicker onApply={(content) => { first.current = true; setC(content); setPreviewKey((k) => k + 1); setDirtySincePublish(true); }} />
        <HistoryButton versions={p.versions} />
        <PublishButton onDone={() => { setDirtySincePublish(false); router.refresh(); }} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,460px)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <div role="tablist" aria-label="Editor" className="inline-flex w-fit rounded-lg border border-border bg-surface p-0.5">
            {([["sections", "Sections"], ["look", "Look & settings"]] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} type="button" onClick={() => setTab(id)} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", tab === id ? "bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
          {tab === "sections" ? (
            <>
              <p className="text-sm text-muted-foreground">Switch sections on or off any time — switching off never deletes what you wrote.</p>
              <ul className="grid gap-2" data-testid="site-sections">
                {c.sections.map((b, i) => (
                  <li key={b.id} className={cn("rounded-card border bg-surface shadow-card", b.enabled ? "border-border" : "border-dashed border-border opacity-80")}>
                    <div className="flex items-center gap-2 p-2.5">
                      <Switch checked={b.enabled} onCheckedChange={(v) => setBlock(b.id, { enabled: v })} aria-label={`Show ${BLOCK_LABELS[b.type].label}`} />
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                        {open === b.id ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                        <span className="min-w-0"><span className="block truncate font-medium">{BLOCK_LABELS[b.type].label}</span><span className="block truncate text-xs text-muted-foreground">{b.enabled ? BLOCK_LABELS[b.type].hint : "Hidden"}</span></span>
                      </button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Move ${BLOCK_LABELS[b.type].label} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp aria-hidden /></Button>
                      <Button size="icon-sm" variant="ghost" aria-label={`Move ${BLOCK_LABELS[b.type].label} down`} disabled={i === c.sections.length - 1} onClick={() => move(i, 1)}><ArrowDown aria-hidden /></Button>
                    </div>
                    {open === b.id ? (
                      <div className="grid gap-3 border-t border-border p-3">
                        <BlockForm b={b} set={(patch) => setBlock(b.id, patch)} />
                        <div className="flex justify-end"><Button size="sm" variant="ghost" onClick={() => { if (confirm(`Remove the ${BLOCK_LABELS[b.type].label} section? (To keep it for later, switch it off instead.)`)) setC({ ...c, sections: c.sections.filter((s) => s.id !== b.id) }); }}><Trash2 aria-hidden /> Remove section</Button></div>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
              <AddSection onAdd={add} />
            </>
          ) : (
            <LookAndSettings c={c} setC={setC} orgSlug={p.orgSlug} live={p.live} customDomain={p.customDomain} subdomainUrl={p.subdomainUrl} />
          )}
        </div>

        <div className="grid content-start gap-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Preview <span className="font-normal text-muted-foreground">(your latest draft)</span></p>
            <div className="inline-flex rounded-lg border border-border bg-surface p-0.5">
              <button type="button" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={cn("rounded-md p-1.5", device === "desktop" && "bg-primary-soft")} aria-label="Computer view"><Monitor className="size-4" aria-hidden /></button>
              <button type="button" aria-pressed={device === "phone"} onClick={() => setDevice("phone")} className={cn("rounded-md p-1.5", device === "phone" && "bg-primary-soft")} aria-label="Phone view"><Smartphone className="size-4" aria-hidden /></button>
            </div>
          </div>
          <div className="flex justify-center rounded-card border border-border bg-surface-muted p-2">
            <iframe key={previewKey} title="Website preview" src={`/s/${p.orgSlug}?preview=1`} className={cn("h-[78vh] rounded-lg border border-border bg-white", device === "phone" ? "w-[390px]" : "w-full")} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Section forms ─────────────────────────────────────────────────────────────

function BlockForm({ b, set }: { b: Block; set: (patch: Partial<Block>) => void }) {
  const t = (k: string, label: string, max: number, area = false) => (
    <Field label={label}>{(a) => area ? <Textarea {...a} rows={4} maxLength={max} value={String((b as Record<string, unknown>)[k] ?? "")} onChange={(e) => set({ [k]: e.target.value } as Partial<Block>)} /> : <Input {...a} maxLength={max} value={String((b as Record<string, unknown>)[k] ?? "")} onChange={(e) => set({ [k]: e.target.value } as Partial<Block>)} />}</Field>
  );
  const sw = (k: string, label: string) => (
    <label className="flex items-center justify-between gap-2 text-sm"><span>{label}</span><Switch checked={Boolean((b as Record<string, unknown>)[k])} onCheckedChange={(v) => set({ [k]: v } as Partial<Block>)} aria-label={label} /></label>
  );
  switch (b.type) {
    case "hero":
      return (<>{t("headline", "Headline", 120)}{t("subtext", "Text under the headline", 400, true)}
        <ImagePicker label="Background photo" value={b.imageId} onChange={(imageId) => set({ imageId })} />
        <ButtonEditor label="Main button" value={b.primary} onChange={(primary) => set({ primary })} />
        <ButtonEditor label="Second button" value={b.secondary} onChange={(secondary) => set({ secondary })} /></>);
    case "announcements":
      return (<>{t("title", "Section title", 80)}
        <ListEditor items={b.items} onChange={(items) => set({ items })} addLabel="Add announcement" blank={{ title: "", date: new Date().toISOString().slice(0, 10), body: "" }} render={(it, up) => (<>
          <Field label="Title">{(a) => <Input {...a} maxLength={120} value={it.title} onChange={(e) => up({ ...it, title: e.target.value })} />}</Field>
          <Field label="Date">{(a) => <Input {...a} type="date" value={it.date} onChange={(e) => up({ ...it, date: e.target.value })} />}</Field>
          <Field label="Message">{(a) => <Textarea {...a} rows={3} maxLength={2000} value={it.body} onChange={(e) => up({ ...it, body: e.target.value })} />}</Field></>)} /></>);
    case "vacancies":
      return (<>{t("title", "Section title", 80)}{t("intro", "Intro text", 400, true)}
        <Field label="Show up to (homes)">{(a) => <Input {...a} inputMode="numeric" className="w-24" value={String(b.max)} onChange={(e) => set({ max: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />}</Field>
        {sw("showRent", "Show the rent")}
        <p className="text-xs text-muted-foreground">Homes appear here automatically when you publish a listing (Properties → For-rent ads), and disappear when they&apos;re rented.</p></>);
    case "apply":
      return (<>{t("title", "Title", 80)}{t("body", "Text", 600, true)}{t("buttonLabel", "Button text", 40)}</>);
    case "showing":
      return (<>{t("title", "Title", 80)}{t("body", "Text", 600, true)}<p className="text-xs text-muted-foreground">Tour requests go to People interested, and you get a notification.</p></>);
    case "about":
      return (<>{t("title", "Title", 80)}{t("body", "Your story", 3000, true)}
        <ListEditor items={b.team} onChange={(team) => set({ team })} addLabel="Add team member" blank={{ name: "", role: "", imageId: null }} render={(it, up) => (<>
          <Field label="Name">{(a) => <Input {...a} maxLength={80} value={it.name} onChange={(e) => up({ ...it, name: e.target.value })} />}</Field>
          <Field label="Role">{(a) => <Input {...a} maxLength={80} value={it.role} onChange={(e) => up({ ...it, role: e.target.value })} />}</Field>
          <ImagePicker label="Photo" value={it.imageId} onChange={(imageId) => up({ ...it, imageId })} /></>)} /></>);
    case "testimonials":
      return (<>{t("title", "Title", 80)}
        <ListEditor items={b.items} onChange={(items) => set({ items })} addLabel="Add review" blank={{ quote: "", name: "" }} render={(it, up) => (<>
          <Field label="What they said">{(a) => <Textarea {...a} rows={2} maxLength={600} value={it.quote} onChange={(e) => up({ ...it, quote: e.target.value })} />}</Field>
          <Field label="Name">{(a) => <Input {...a} maxLength={80} value={it.name} onChange={(e) => up({ ...it, name: e.target.value })} />}</Field></>)} /></>);
    case "amenities":
      return (<>{t("title", "Title", 80)}
        <Field label="Amenities (one per line)">{(a) => <Textarea {...a} rows={6} value={b.items.join("\n")} onChange={(e) => set({ items: e.target.value.split("\n").map((x) => x.slice(0, 80)).slice(0, 40) })} />}</Field></>);
    case "faq":
      return (<>{t("title", "Title", 80)}
        <ListEditor items={b.items} onChange={(items) => set({ items })} addLabel="Add question" blank={{ q: "", a: "" }} render={(it, up) => (<>
          <Field label="Question">{(a) => <Input {...a} maxLength={200} value={it.q} onChange={(e) => up({ ...it, q: e.target.value })} />}</Field>
          <Field label="Answer">{(a) => <Textarea {...a} rows={3} maxLength={1500} value={it.a} onChange={(e) => up({ ...it, a: e.target.value })} />}</Field></>)} /></>);
    case "gallery":
      return (<>{t("title", "Title", 80)}{sw("fromProperties", "Include my property photos automatically")}
        <div className="grid gap-2">
          <p className="text-sm font-medium">Extra photos</p>
          <ul className="flex flex-wrap gap-2">{b.imageIds.map((id) => (
            <li key={id} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/images/${id}`} alt="" className="size-16 rounded-md object-cover" />
              <button type="button" aria-label="Remove photo" onClick={() => set({ imageIds: b.imageIds.filter((x) => x !== id) })} className="absolute -right-1.5 -top-1.5 rounded-full bg-surface p-0.5 shadow ring-1 ring-border"><X className="size-3" aria-hidden /></button>
            </li>))}</ul>
          <ImagePicker label="Add a photo" value={null} onChange={(id) => id && set({ imageIds: [...b.imageIds, id].slice(0, 24) })} />
        </div></>);
    case "neighborhood":
      return (<>{t("title", "Title", 80)}{t("body", "What's nearby", 3000, true)}{t("address", "Address or area for the map link", 200)}</>);
    case "contact":
      return (<>{t("title", "Title", 80)}{t("body", "Text", 600, true)}{t("hours", "Office hours", 300, true)}{sw("showPhone", "Show our phone number")}{sw("showEmail", "Show our email")}
        <p className="text-xs text-muted-foreground">Phone and email come from Settings → Company. Messages go to People interested.</p></>);
    case "residents":
      return (<>{t("title", "Title", 80)}{t("body", "Text", 600, true)}{sw("tenantLogin", "Resident login button")}{sw("payRent", "Pay rent button")}{sw("maintenance", "Request a repair button")}{sw("ownerLogin", "Owner login button")}</>);
  }
}

function ButtonEditor({ label, value, onChange }: { label: string; value: { label: string; target: Target } | null; onChange: (v: { label: string; target: Target } | null) => void }) {
  return (
    <fieldset className="grid gap-2 rounded-lg border border-border p-2.5">
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked ? { label: TARGETS.vacancies, target: "vacancies" } : null)} /> Show this button</label>
      {value ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Goes to">{(a) => <NativeSelect {...a} value={value.target} onChange={(e) => { const target = e.target.value as Target; onChange({ target, label: Object.values(TARGETS).includes(value.label as never) || !value.label ? TARGETS[target] : value.label }); }}>{Object.entries(TARGETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>}</Field>
          <Field label="Button text">{(a) => <Input {...a} maxLength={40} value={value.label} onChange={(e) => onChange({ ...value, label: e.target.value })} />}</Field>
        </div>
      ) : null}
    </fieldset>
  );
}

function ListEditor<T>({ items, onChange, render, addLabel, blank }: { items: T[]; onChange: (v: T[]) => void; render: (it: T, update: (v: T) => void) => React.ReactNode; addLabel: string; blank: T }) {
  return (
    <div className="grid gap-2">
      {items.map((it, i) => (
        <div key={i} className="grid gap-2 rounded-lg border border-border p-2.5">
          {render(it, (v) => onChange(items.map((x, j) => (j === i ? v : x))))}
          <div className="flex justify-end gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => { const n = [...items]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; onChange(n); }}><ArrowUp aria-hidden /></Button>
            <Button size="sm" variant="ghost" onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 aria-hidden /> Remove</Button>
          </div>
        </div>
      ))}
      <div><Button size="sm" variant="secondary" onClick={() => onChange([...items, structuredClone(blank)])}><Plus aria-hidden /> {addLabel}</Button></div>
    </div>
  );
}

function ImagePicker({ label, value, onChange }: { label: string; value: string | null; onChange: (id: string | null) => void }) {
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {value ? <img src={`/api/images/${value}`} alt="" className="h-14 w-20 rounded-md object-cover" /> : null}
      <label htmlFor={id} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border-strong bg-surface px-3 font-medium hover:bg-surface-muted focus-within:ring-2 focus-within:ring-ring">
        {busy ? <Upload className="size-4 animate-pulse" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />} {busy ? "Uploading…" : value ? `Change ${label.toLowerCase()}` : label}
        <input id={id} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fd = new FormData();
          fd.append("file", f);
          setBusy(true);
          const r = await uploadSiteImageAction(fd);
          setBusy(false);
          if (!r.ok) return void toast.error(r.error);
          onChange(r.data.id);
        }} />
      </label>
      {value ? <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Remove</Button> : null}
    </div>
  );
}

function AddSection({ onAdd }: { onAdd: (t: BlockType) => void }) {
  const [t, setT] = React.useState<BlockType>("announcements");
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-card border border-dashed border-border p-3">
      <Field label="Add a section">{(a) => <NativeSelect {...a} value={t} onChange={(e) => setT(e.target.value as BlockType)} className="w-64">{(Object.keys(BLOCK_LABELS) as BlockType[]).map((k) => <option key={k} value={k}>{BLOCK_LABELS[k].label}</option>)}</NativeSelect>}</Field>
      <Button onClick={() => onAdd(t)}><Plus aria-hidden /> Add</Button>
    </div>
  );
}

// ─── Look, settings, publish, history, designs ──────────────────────────────

function LookAndSettings({ c, setC, orgSlug, live, customDomain, subdomainUrl }: { c: SiteContent; setC: (c: SiteContent) => void; orgSlug: string; live: boolean; customDomain: string | null; subdomainUrl: string | null }) {
  const router = useRouter();
  const [domain, setDomain] = React.useState(customDomain ?? "");
  const theme = (patch: Partial<SiteContent["theme"]>) => setC({ ...c, theme: { ...c.theme, ...patch } });
  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-card border border-border bg-surface p-3 shadow-card">
        <h3 className="flex items-center gap-2 font-semibold"><Palette className="size-4" aria-hidden /> Look</h3>
        <Field label="Website name">{(a) => <Input {...a} maxLength={80} value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} />}</Field>
        <Field label="Short tagline">{(a) => <Input {...a} maxLength={160} value={c.tagline} onChange={(e) => setC({ ...c, tagline: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Main color" description="Too-light colors are darkened so text stays readable.">{(a) => <input {...a} type="color" className="h-10 w-full cursor-pointer rounded-md border border-input" value={c.theme.primary} onChange={(e) => theme({ primary: e.target.value })} />}</Field>
          <Field label="Accent color">{(a) => <input {...a} type="color" className="h-10 w-full cursor-pointer rounded-md border border-input" value={c.theme.accent} onChange={(e) => theme({ accent: e.target.value })} />}</Field>
        </div>
        <Field label="Font">{(a) => <NativeSelect {...a} value={c.theme.font} onChange={(e) => theme({ font: e.target.value as SiteContent["theme"]["font"] })}>{Object.entries(FONTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect>}</Field>
        <label className="flex items-center justify-between text-sm"><span>Rounded corners</span><Switch checked={c.theme.rounded} onCheckedChange={(v) => theme({ rounded: v })} aria-label="Rounded corners" /></label>
        <label className="flex items-center justify-between text-sm"><span>Dark background</span><Switch checked={c.theme.dark} onCheckedChange={(v) => theme({ dark: v })} aria-label="Dark background" /></label>
        <p className="text-xs text-muted-foreground">Your logo comes from Settings → Company.</p>
      </section>
      <section className="grid gap-3 rounded-card border border-border bg-surface p-3 shadow-card">
        <h3 className="font-semibold">Search engines &amp; footer</h3>
        <Field label="Description for Google" description="One or two sentences about you and where your homes are.">{(a) => <Textarea {...a} rows={2} maxLength={300} value={c.seoDescription} onChange={(e) => setC({ ...c, seoDescription: e.target.value })} />}</Field>
        <Field label="Extra footer text (optional)">{(a) => <Textarea {...a} rows={2} maxLength={400} value={c.footerText} onChange={(e) => setC({ ...c, footerText: e.target.value })} />}</Field>
        <p className="text-xs text-muted-foreground">The Equal Housing Opportunity statement is always shown in the footer.</p>
        <Field label="Visitor counts with Plausible (optional)" description="Your domain as set up at plausible.io — free and private.">{(a) => <Input {...a} placeholder="example.com" value={c.analytics.plausibleDomain} onChange={(e) => setC({ ...c, analytics: { plausibleDomain: e.target.value.trim() } })} />}</Field>
      </section>
      <section className="grid gap-3 rounded-card border border-border bg-surface p-3 shadow-card">
        <h3 className="font-semibold">Address &amp; visibility</h3>
        <p className="text-sm">Your website: <a className="font-medium text-primary underline" href={`/s/${orgSlug}`} target="_blank" rel="noreferrer">/s/{orgSlug}</a>{subdomainUrl ? <> and <a className="font-medium text-primary underline" href={subdomainUrl} target="_blank" rel="noreferrer">{subdomainUrl.replace(/^https?:\/\//, "")}</a></> : null}</p>
        <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); const r = await setSiteDomainAction(domain || null); if (!r.ok) return void toast.error(r.error); toast.success(r.message ?? "Saved"); router.refresh(); }}>
          <Field label="Your own domain (optional)">{(a) => <Input {...a} placeholder="www.yourcompany.com" className="w-64" value={domain} onChange={(e) => setDomain(e.target.value)} />}</Field>
          <Button type="submit" variant="secondary">Save domain</Button>
        </form>
        {customDomain ? <p className="rounded-lg bg-surface-muted p-2.5 text-xs">At your domain company, add a <strong>CNAME</strong> record: name <code>{customDomain.split(".")[0]}</code> → value <code>{(subdomainUrl ?? "your DeedWood address").replace(/^https?:\/\//, "")}</code>. It can take up to a day to start working. (Your hosting company must also add the domain — see docs/DEPLOY.md.)</p> : null}
        <label className="flex items-center justify-between text-sm"><span>Website visible to the public</span><Switch checked={live} onCheckedChange={async (v) => { const r = await setSiteLiveAction(v); if (!r.ok) return void toast.error(r.error); toast.success(r.message ?? "Saved"); router.refresh(); }} aria-label="Website visible to the public" /></label>
      </section>
    </div>
  );
}

function PublishButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = React.useState(false);
  return <Button loading={busy} onClick={async () => { setBusy(true); const r = await publishSiteAction(); setBusy(false); if (!r.ok) return void toast.error(r.error); toast.success("Your website is published"); onDone(); }}>Publish</Button>;
}

function HistoryButton({ versions }: { versions: Props["versions"] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><History aria-hidden /> History</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="hist-desc">
          <DialogHeader><DialogTitle>Published versions</DialogTitle><DialogDescription id="hist-desc">Put an earlier version back on your website. Your current one stays in this list.</DialogDescription></DialogHeader>
          <DialogBody>
            {versions.length ? (
              <ul className="divide-y divide-border text-sm">
                {versions.map((v, i) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 py-2">
                    <span>{new Date(v.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} {i === 0 ? <Badge tone="success">Live</Badge> : null}<span className="block text-xs text-muted-foreground">{v.note ?? "Published"} · {v.by}</span></span>
                    {i > 0 ? <Button size="sm" variant="secondary" onClick={async () => { const r = await restoreSiteVersionAction(v.id); if (!r.ok) return void toast.error(r.error); toast.success("That version is back"); setOpen(false); router.refresh(); window.location.reload(); }}>Put this back</Button> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">Nothing published yet.</p>}
          </DialogBody>
          <DialogFooter><Button variant="ghost" onClick={() => setOpen(false)}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TemplatePicker({ onApply }: { onApply: (c: SiteContent) => void }) {
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><Palette aria-hidden /> Designs</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="tpl-desc" className="max-w-2xl">
          <DialogHeader><DialogTitle>Start from a design</DialogTitle><DialogDescription id="tpl-desc">This replaces your draft (your published website doesn&apos;t change until you press Publish).</DialogDescription></DialogHeader>
          <DialogBody className="grid gap-3 sm:grid-cols-2">
            {Object.entries(TEMPLATES).map(([k, t]) => (
              <button key={k} type="button" disabled={Boolean(busy)} onClick={async () => { setBusy(k); const r = await applySiteTemplateAction(k); setBusy(null); if (!r.ok) return void toast.error(r.error); onApply(r.data); toast.success(`${t.label} design applied`); setOpen(false); }}
                className="rounded-card border border-border bg-surface p-4 text-left hover:border-primary focus-visible:outline-2">
                <span className="block font-semibold">{t.label}{busy === k ? " …" : ""}</span><span className="block text-sm text-muted-foreground">{t.hint}</span>
              </button>
            ))}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
}
