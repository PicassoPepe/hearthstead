"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Check, CreditCard, FileSpreadsheet, PartyPopper, Plus, Sparkles, Trash2, Users, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { LogoPicker } from "@/components/images/branding-images";
import { TIMEZONES } from "@/lib/schemas";
import { US_STATES } from "@/lib/rentals";
import { cn } from "@/lib/utils";
import { updateCompany } from "@/server/actions/company";
import { connectPayments } from "@/server/actions/payments";
import { inviteMember } from "@/server/actions/members";
import { exploreSampleData } from "@/server/actions/onboarding";
import { setPreference } from "@/server/actions/preferences";

type Org = { name: string; email: string; phone: string; addressLine1: string; city: string; state: string; postalCode: string; timezone: string; brandColor: string; logoUrl: string | null; isSandbox: boolean };
type Role = { id: string; name: string; key: string | null };

const STEPS = [
  { n: 1, label: "Company", icon: Building2 },
  { n: 2, label: "Properties", icon: Wand2 },
  { n: 3, label: "Get paid", icon: CreditCard },
  { n: 4, label: "Team", icon: Users },
] as const;

export function SetupWizard({ initialStep, firstName, org, propertyCount, paymentsConnected, paymentsOn, roles, memberCount }: {
  initialStep: number; firstName: string | null; org: Org; propertyCount: number; paymentsConnected: boolean; paymentsOn: boolean; roles: Role[]; memberCount: number;
}) {
  const router = useRouter();
  const [step, setStep] = React.useState(!paymentsOn && initialStep === 3 ? 4 : initialStep);
  const [done, setDone] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  React.useEffect(() => headingRef.current?.focus(), [step, done]);
  const go = (n: number) => {
    setStep(n);
    window.history.replaceState(null, "", `/app/setup?step=${n}`);
  };
  const finish = async () => {
    await setPreference("setupDone", true);
    setDone(true);
  };

  if (done)
    return (
      <div className="mx-auto max-w-2xl py-6 text-center page-enter">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground"><PartyPopper className="size-8" aria-hidden /></div>
        <h1 ref={headingRef} tabIndex={-1} className="text-3xl font-bold tracking-tight outline-none">You&apos;re all set{firstName ? `, ${firstName}` : ""}!</h1>
        <p className="mt-2 text-muted-foreground">Here are good next steps. You can always find setup again under Help.</p>
        <ul className="mt-6 grid gap-3 text-left sm:grid-cols-2">
          {[
            { href: "/app/new/lease", t: "Add a lease", d: "Tenants, rent and deposit — charges post automatically." },
            { href: "/app/rentals/listings", t: "List a vacancy", d: "Publish to your listings site and apply online." },
            { href: "/app/settings/late-fees", t: "Review late fees", d: "Grace period, amount and caps." },
            { href: "/app/overview", t: "Go to your dashboard", d: "See rent, tasks and occupancy at a glance." },
          ].map((x) => (
            <li key={x.href}><Link href={x.href} className="card-hover block h-full rounded-card border border-border bg-surface p-4 shadow-card"><span className="font-semibold">{x.t}</span><span className="mt-1 block text-sm text-muted-foreground">{x.d}</span></Link></li>
          ))}
        </ul>
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm font-medium text-primary">Welcome to DeedWood{firstName ? `, ${firstName}` : ""}</p>
      <h1 ref={headingRef} tabIndex={-1} className="mt-1 text-3xl font-bold tracking-tight outline-none">Let&apos;s set up {org.name}</h1>
      <p className="mt-1 text-muted-foreground">{paymentsOn ? "Four" : "Three"} quick steps. Skip anything — it&apos;s all in Settings later.</p>

      <nav aria-label="Setup steps" className="my-6">
        <ol className={cn("grid gap-2", paymentsOn ? "grid-cols-4" : "grid-cols-3")}>
          {STEPS.filter((s) => paymentsOn || s.n !== 3).map((s) => (
            <li key={s.n}>
              <button type="button" onClick={() => go(s.n)} aria-current={s.n === step ? "step" : undefined}
                className={cn("flex w-full flex-col items-center gap-1.5 rounded-lg p-2 text-xs font-medium transition-colors sm:flex-row sm:text-sm", s.n === step ? "bg-primary-soft text-primary-soft-foreground" : s.n < step ? "text-foreground hover:bg-surface-muted" : "text-muted-foreground hover:bg-surface-muted")}>
                <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full border", s.n < step ? "border-primary bg-primary text-primary-foreground" : s.n === step ? "border-primary" : "border-border-strong")}>
                  {s.n < step ? <Check className="size-4" aria-hidden /> : s.n}
                </span>
                {s.label}<span className="sr-only">{s.n < step ? " (visited)" : ""}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="rounded-card border border-border bg-surface p-5 shadow-card sm:p-6 page-enter" key={step}>
        {step === 1 ? <CompanyStep org={org} onNext={() => go(2)} /> : null}
        {step === 2 ? (
          <PropertyStep propertyCount={propertyCount} isSandbox={org.isSandbox} onNext={() => go(paymentsOn ? 3 : 4)} onSample={async () => {
            const r = await exploreSampleData();
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            router.push("/app/overview?welcome=sample");
            router.refresh();
          }} />
        ) : null}
        {step === 3 && paymentsOn ? <PaymentsStep connected={paymentsConnected} onNext={() => go(4)} /> : null}
        {step === 4 ? <TeamStep roles={roles} memberCount={memberCount} onFinish={finish} /> : null}
      </div>
      <p className="mt-4 text-center text-sm"><button type="button" className="text-muted-foreground underline-offset-4 hover:underline" onClick={async () => { await setPreference("setupDone", true); router.push("/app/overview"); }}>Skip setup for now</button></p>
    </div>
  );
}

function StepHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function CompanyStep({ org, onNext }: { org: Org; onNext: () => void }) {
  const [v, setV] = React.useState(org);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const set = (p: Partial<Org>) => setV({ ...v, ...p });
  return (
    <form noValidate onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await updateCompany({ name: v.name, email: v.email, phone: v.phone, addressLine1: v.addressLine1, city: v.city, state: v.state, postalCode: v.postalCode, timezone: v.timezone, brandColor: v.brandColor });
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      toast.success("Company details saved");
      onNext();
    }}>
      <StepHeader title="Your company" description="This appears on statements, emails, the resident and owner portals and your listings site." />
      <div className="mb-5"><LogoPicker current={org.logoUrl} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company name" required error={errors.name} className="sm:col-span-2">{(p) => <Input {...p} value={v.name} onChange={(e) => set({ name: e.target.value })} />}</Field>
        <Field label="Office email" error={errors.email}>{(p) => <Input {...p} type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} />}</Field>
        <Field label="Office phone" error={errors.phone}>{(p) => <Input {...p} type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} />}</Field>
        <Field label="Street address" className="sm:col-span-2">{(p) => <Input {...p} autoComplete="street-address" value={v.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} />}</Field>
        <Field label="City">{(p) => <Input {...p} value={v.city} onChange={(e) => set({ city: e.target.value })} />}</Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="State">{(p) => <NativeSelect {...p} value={v.state} onChange={(e) => set({ state: e.target.value })}><option value="">—</option>{US_STATES.map((s) => <option key={s}>{s}</option>)}</NativeSelect>}</Field>
          <Field label="ZIP">{(p) => <Input {...p} inputMode="numeric" value={v.postalCode} onChange={(e) => set({ postalCode: e.target.value })} />}</Field>
        </div>
        <Field label="Time zone" description="Rent due dates and late fees use this.">{(p) => <NativeSelect {...p} value={v.timezone} onChange={(e) => set({ timezone: e.target.value })}>{TIMEZONES.map((t) => <option key={t} value={t}>{t.replace("America/", "").replace("_", " ")}</option>)}</NativeSelect>}</Field>
        <Field label="Brand color" error={errors.brandColor} description="Used in the portals and on your listings site.">
          {(p) => <div className="flex gap-2"><input type="color" aria-label="Pick brand color" value={v.brandColor} onChange={(e) => set({ brandColor: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-border" /><Input {...p} value={v.brandColor} onChange={(e) => set({ brandColor: e.target.value })} /></div>}
        </Field>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onNext}>Skip for now</Button>
        <Button type="submit" loading={busy}>Save and continue</Button>
      </div>
    </form>
  );
}

function PropertyStep({ propertyCount, isSandbox, onNext, onSample }: { propertyCount: number; isSandbox: boolean; onNext: () => void; onSample: () => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const choices = [
    { icon: Plus, title: "Add a property", body: "A guided form: address, units, rents, owners and bank accounts. About 2 minutes.", action: <Button asChild><Link href="/app/new/property">Add property</Link></Button> },
    { icon: FileSpreadsheet, title: "Import a spreadsheet", body: "Bring properties, units, tenants and owners from a CSV or your old software.", action: <Button asChild variant="secondary"><Link href="/app/files?import=properties">Import CSV</Link></Button> },
    ...(!isSandbox ? [{ icon: Sparkles, title: "Explore with sample data", body: "Try everything in a separate sandbox full of sample properties, tenants and tasks. Your real books stay clean.", action: <Button variant="secondary" loading={busy} onClick={async () => { setBusy(true); await onSample(); setBusy(false); }}>Load sample data</Button> }] : []),
  ];
  return (
    <div>
      <StepHeader title="Add your properties" description={propertyCount ? `You have ${propertyCount} ${propertyCount === 1 ? "property" : "properties"} — add more now or continue.` : "Start with one property, import what you have, or look around with sample data first."} />
      <ul className="grid gap-3 md:grid-cols-3">
        {choices.map((c) => (
          <li key={c.title} className="flex flex-col rounded-card border border-border p-4">
            <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"><c.icon className="size-5" aria-hidden /></span>
            <h3 className="font-semibold">{c.title}</h3>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">{c.body}</p>
            <div className="mt-4">{c.action}</div>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex justify-end"><Button variant={propertyCount ? "primary" : "ghost"} onClick={onNext}>{propertyCount ? "Continue" : "Skip for now"}</Button></div>
    </div>
  );
}

function PaymentsStep({ connected, onNext }: { connected: boolean; onNext: () => void }) {
  const [ok, setOk] = React.useState(connected);
  const [busy, setBusy] = React.useState(false);
  return (
    <div>
      <StepHeader title="Collect rent online" description="Tenants pay by bank transfer (ACH) or card in the resident portal, or set up autopay. Money lands in your bank account." />
      <div className="flex flex-col gap-4 rounded-card border border-border p-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground"><CreditCard className="size-5" aria-hidden /></span>
        <div className="flex-1">
          <h3 className="font-semibold">{ok ? "Online payments are connected" : "Connect online payments"}</h3>
          <p className="text-sm text-muted-foreground">{ok ? "Tenants can pay as soon as they're invited to the portal." : "Verifies your business and payout account with the payment processor. (Runs in demo mode when no keys are configured.)"}</p>
        </div>
        {ok ? <span className="inline-flex items-center gap-1 text-sm font-semibold text-success"><Check className="size-4" aria-hidden /> Connected</span> : (
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            const r = await connectPayments();
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            setOk(true);
            toast.success("Payments connected");
          }}>Connect payments</Button>
        )}
      </div>
      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <li><Link className="text-primary underline-offset-4 hover:underline" href="/app/settings/late-fees">Late-fee policy →</Link></li>
        <li><Link className="text-primary underline-offset-4 hover:underline" href="/app/settings/notifications">Rent reminders →</Link></li>
        <li><Link className="text-primary underline-offset-4 hover:underline" href="/app/settings/tenant-portal">Resident portal options →</Link></li>
        <li><Link className="text-primary underline-offset-4 hover:underline" href="/app/accounting">Bank accounts &amp; chart of accounts →</Link></li>
      </ul>
      <div className="mt-6 flex justify-end"><Button variant={ok ? "primary" : "ghost"} onClick={onNext}>{ok ? "Continue" : "Skip for now"}</Button></div>
    </div>
  );
}

function TeamStep({ roles, memberCount, onFinish }: { roles: Role[]; memberCount: number; onFinish: () => Promise<void> }) {
  const def = roles.find((r) => r.key === "PROPERTY_MANAGER")?.id ?? roles[0]?.id ?? "";
  const [rows, setRows] = React.useState([{ name: "", email: "", roleId: def }]);
  const [sent, setSent] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const setRow = (i: number, p: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <form noValidate onSubmit={async (e) => {
      e.preventDefault();
      const todo = rows.filter((r) => r.email.trim());
      if (!todo.length) return void (await onFinish());
      setBusy(true);
      const ok: string[] = [];
      for (const r of todo) {
        const res = await inviteMember({ name: r.name.trim() || r.email.split("@")[0]!, email: r.email.trim(), roleId: r.roleId });
        if (res.ok) ok.push(r.email.trim());
        else toast.error(`${r.email}: ${res.error}`);
      }
      setBusy(false);
      setSent([...sent, ...ok]);
      if (ok.length) toast.success(`${ok.length} invitation${ok.length === 1 ? "" : "s"} sent`);
      if (ok.length === todo.length) await onFinish();
    }}>
      <StepHeader title="Invite your team" description={`Each person gets an email to join, with exactly the access their role allows.${memberCount > 1 ? ` You already have ${memberCount} people on the team.` : ""}`} />
      <ul className="grid gap-3">
        {rows.map((r, i) => (
          <li key={i} className="grid gap-2 sm:grid-cols-[1fr_1.3fr_1fr_auto] sm:items-end">
            <Field label={`Name ${i + 1}`}>{(p) => <Input {...p} value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} />}</Field>
            <Field label={`Email ${i + 1}`}>{(p) => <Input {...p} type="email" value={r.email} onChange={(e) => setRow(i, { email: e.target.value })} />}</Field>
            <Field label={`Role ${i + 1}`}>{(p) => <NativeSelect {...p} value={r.roleId} onChange={(e) => setRow(i, { roleId: e.target.value })}>{roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</NativeSelect>}</Field>
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove person ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
          </li>
        ))}
      </ul>
      {rows.length < 10 ? <Button type="button" variant="ghost" className="mt-2" onClick={() => setRows([...rows, { name: "", email: "", roleId: def }])}><Plus aria-hidden /> Add another person</Button> : null}
      {sent.length ? <p role="status" className="mt-3 text-sm text-success">Invited: {sent.join(", ")}</p> : null}
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => void onFinish()}>Skip</Button>
        <Button type="submit" loading={busy}>{rows.some((r) => r.email.trim()) ? "Send invites and finish" : "Finish setup"}</Button>
      </div>
    </form>
  );
}
