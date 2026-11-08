"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { Wizard, type WizardStep } from "@/components/patterns/wizard";
import { useCreateModal } from "@/components/create/create-modal";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";
import { addMonths, addDays, formatDate, parseISODate, startOfMonth, toISODate } from "@/lib/dates";
import { prorateMonthly } from "@/server/ledger/math";
import { LEASE_ROLES, ROLE_LABEL, leaseWizardSchema, rangesOverlap, type LeaseWizardInput } from "@/lib/leasing";
import { createLease } from "@/server/actions/leasing";
import type { LeaseWizardOptions } from "@/server/leasing/queries";
import { cn } from "@/lib/utils";

type Role = (typeof LEASE_ROLES)[number];
type TenantRow = { key: string; mode: "existing" | "new"; tenantId: string; role: Role; firstName: string; lastName: string; email: string; phone: string };
type ChargeRow = { key: string; accountId: string; description: string; amountCents: number | null };
type Overrides = { lateFeesEnabled?: boolean; graceDays?: number; lateFeeCents?: number; partialPayments?: boolean };

let seq = 0;
const k = () => `r${seq++}`;

export type LeasePreset = {
  propertyId?: string; unitId?: string; tenantId?: string;
  /** From an approved application. */
  applicationId?: string; tenant?: { firstName: string; lastName: string; email: string; phone: string };
  rentCents?: number | null; depositCents?: number | null; startDate?: string | null; termMonths?: number;
};

export function LeaseWizard({ options, preset }: { options: LeaseWizardOptions; preset?: LeasePreset }) {
  const router = useRouter();
  const modal = useCreateModal();
  const close = modal ? modal.close : () => router.push("/app/leasing");

  const presetProperty = preset?.propertyId ?? options.properties.find((p) => p.units.some((u) => u.id === preset?.unitId))?.id ?? "";
  const nextFirst = toISODate(startOfMonth(addMonths(parseISODate(options.today), 1)));
  const [propertyId, setPropertyId] = React.useState(presetProperty);
  const [unitIds, setUnitIds] = React.useState<string[]>(preset?.unitId ? [preset.unitId] : []);
  const [termType, setTermType] = React.useState<"FIXED" | "MONTH_TO_MONTH">("FIXED");
  const firstStart = preset?.startDate ?? nextFirst;
  const [startDate, setStartDate] = React.useState(firstStart);
  const [endDate, setEndDate] = React.useState(toISODate(addDays(addMonths(parseISODate(firstStart), preset?.termMonths ?? 12), -1)));
  const [rentDueDay, setRentDueDay] = React.useState(1);
  const [tenants, setTenants] = React.useState<TenantRow[]>([
    { key: k(), mode: preset?.tenantId ? "existing" : "new", tenantId: preset?.tenantId ?? "", role: "PRIMARY", firstName: preset?.tenant?.firstName ?? "", lastName: preset?.tenant?.lastName ?? "", email: preset?.tenant?.email ?? "", phone: preset?.tenant?.phone ?? "" },
  ]);
  const [rentCents, setRentCents] = React.useState<number | null>(preset?.rentCents ?? null);
  const [others, setOthers] = React.useState<ChargeRow[]>([]);
  const [depositCents, setDepositCents] = React.useState<number | null>(preset?.depositCents ?? null);
  const [depositHandling, setDepositHandling] = React.useState<"CHARGE" | "RECEIVED" | "NONE">("CHARGE");
  const [overrides, setOverrides] = React.useState<Overrides>({});
  const [documents, setDocuments] = React.useState<"NONE" | "OFFLINE" | "ESIGN">("ESIGN");
  const [portalInvite, setPortalInvite] = React.useState(true);
  const [status, setStatus] = React.useState<"ACTIVE" | "DRAFT">("ACTIVE");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [overlapLeaseId, setOverlapLeaseId] = React.useState<string | null>(null);

  const property = options.properties.find((p) => p.id === propertyId);
  const inherited = propertyId ? options.inherited[propertyId] : undefined;
  const startedInPast = startDate < options.today;

  // Default rent from the selected units' market rent.
  React.useEffect(() => {
    if (!property || unitIds.length === 0) return;
    const sum = property.units.filter((u) => unitIds.includes(u.id)).reduce((s, u) => s + u.marketRentCents, 0);
    setRentCents((r) => (r == null ? sum : r));
    setDepositCents((d) => (d == null ? sum : d));
  }, [property, unitIds]);

  const conflicts = unitIds.flatMap((u) =>
    (options.busy[u] ?? []).filter((b) => rangesOverlap(startDate, termType === "FIXED" ? endDate || null : null, b.start, b.end)).map((b) => ({ unitId: u, ...b })),
  );

  const payload = (): LeaseWizardInput => ({
    status,
    propertyId,
    unitIds,
    termType,
    startDate,
    endDate: termType === "FIXED" ? endDate : "",
    rentDueDay,
    tenants: tenants.map((t) =>
      t.mode === "existing"
        ? { tenantId: t.tenantId, role: t.role }
        : { newTenant: { kind: "PERSON", firstName: t.firstName, lastName: t.lastName, email: t.email, phone: t.phone }, role: t.role },
    ),
    recurring: [
      ...(rentCents ? [{ kind: "RENT" as const, accountId: options.rentAccountId, description: "Rent", amountCents: rentCents }] : []),
      ...others.map((o) => ({ kind: "OTHER" as const, accountId: o.accountId, description: o.description, amountCents: o.amountCents ?? 0 })),
    ],
    deposit: { amountCents: depositHandling === "NONE" ? 0 : (depositCents ?? 0), handling: depositHandling },
    overrides: {
      ...(overrides.lateFeesEnabled !== undefined ? { "lateFees.enabled": overrides.lateFeesEnabled } : {}),
      ...(overrides.graceDays !== undefined ? { "lateFees.graceDays": overrides.graceDays } : {}),
      ...(overrides.lateFeeCents !== undefined ? { "lateFees.amountCents": overrides.lateFeeCents } : {}),
      ...(overrides.partialPayments !== undefined ? { "tenantPortal.allowPartialPayments": overrides.partialPayments } : {}),
    },
    documents,
    portalInvite,
  });

  const check = (prefixes: string[], extra?: () => Record<string, string>): string | null => {
    const res = leaseWizardSchema.safeParse(payload());
    const errs: Record<string, string> = {};
    if (!res.success) {
      for (const i of res.error.issues) {
        const path = i.path.join(".");
        if (prefixes.some((p) => path === p || path.startsWith(p + "."))) errs[path] ??= i.message;
      }
    }
    Object.assign(errs, extra?.() ?? {});
    setErrors(errs);
    const first = Object.values(errs)[0];
    return first ? first : null;
  };

  const err = (p: string) => errors[p] || undefined;
  const rentPreview = (() => {
    if (!rentCents || !startDate) return [];
    const s = parseISODate(startDate);
    const first = prorateMonthly(rentCents, s, s, null);
    const second = startOfMonth(addMonths(s, 1));
    return [
      { label: formatDate(s), detail: first.days < first.daysInMonth ? `Prorated ${first.days} of ${first.daysInMonth} days` : "Full month", amount: first.amountCents },
      { label: formatDate(second), detail: "Full month, then monthly", amount: rentCents },
    ];
  })();

  const steps: WizardStep[] = [
    {
      id: "unit",
      title: "Property, unit & term",
      validate: () =>
        check(["propertyId", "unitIds", "startDate", "endDate", "rentDueDay"], (): Record<string, string> => {
          if (status === "ACTIVE" && conflicts.length) {
            setOverlapLeaseId(conflicts[0]!.leaseId);
            return { unitIds: "This unit already has an active lease for these dates." };
          }
          setOverlapLeaseId(null);
          return {};
        }),
      content: (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Property" error={err("propertyId")} required className="sm:col-span-2">
            {(a) => (
              <NativeSelect {...a} value={propertyId} onChange={(e) => { setPropertyId(e.target.value); setUnitIds([]); setRentCents(null); setDepositCents(null); }}>
                <option value="">Choose a property</option>
                {options.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          {property ? (
            <fieldset className="sm:col-span-2">
              <legend className="mb-1.5 text-[13px] font-medium">Unit{property.units.length > 1 ? "(s)" : ""} <span className="text-danger" aria-hidden>*</span></legend>
              <div className="grid max-h-52 gap-1.5 overflow-y-auto rounded-lg border border-border p-2 sm:grid-cols-2">
                {property.units.map((u) => {
                  const occupied = (options.busy[u.id] ?? []).length > 0;
                  return (
                    <label key={u.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-muted">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--primary)]"
                        checked={unitIds.includes(u.id)}
                        onChange={(e) => { setUnitIds(e.target.checked ? [...unitIds, u.id] : unitIds.filter((x) => x !== u.id)); setRentCents(null); setDepositCents(null); }}
                      />
                      <span className="flex-1">{u.name}</span>
                      <span className="tabular text-xs text-muted-foreground">{formatMoney(u.marketRentCents, { showCents: false })}</span>
                      {occupied ? <Badge tone="warning">Leased</Badge> : <Badge tone="success">Vacant</Badge>}
                    </label>
                  );
                })}
              </div>
              {err("unitIds") ? (
                <p role="alert" className="mt-1.5 text-xs font-medium text-danger">
                  {err("unitIds")}{" "}
                  {overlapLeaseId ? <Link href={`/app/leasing/${overlapLeaseId}`} className="underline">Open that lease to set its move-out date</Link> : null}
                  {overlapLeaseId ? <> or <button type="button" className="underline" onClick={() => setStatus("DRAFT")}>save this one as a draft</button>.</> : null}
                </p>
              ) : null}
            </fieldset>
          ) : null}
          <fieldset className="sm:col-span-2">
            <legend className="mb-1.5 text-[13px] font-medium">Term</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {(["FIXED", "MONTH_TO_MONTH"] as const).map((t) => (
                <label key={t} className="flex items-center gap-2">
                  <input type="radio" name="term" className="size-4 accent-[var(--primary)]" checked={termType === t} onChange={() => setTermType(t)} />
                  {t === "FIXED" ? "Fixed term" : "Month-to-month"}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Start date" error={err("startDate")} required>
            {(a) => <Input {...a} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
          </Field>
          {termType === "FIXED" ? (
            <Field label="End date" error={err("endDate")} required>
              {(a) => (
                <div className="flex gap-2">
                  <Input {...a} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  <Button type="button" variant="secondary" size="sm" className="h-9" onClick={() => startDate && setEndDate(toISODate(addDays(addMonths(parseISODate(startDate), 12), -1)))}>12 mo</Button>
                </div>
              )}
            </Field>
          ) : <div />}
          <Field label="Rent due on day" description="Day of the month rent is due (1–28).">
            {(a) => <Input {...a} type="number" min={1} max={28} value={rentDueDay} onChange={(e) => setRentDueDay(Math.min(28, Math.max(1, Number(e.target.value) || 1)))} />}
          </Field>
        </div>
      ),
    },
    {
      id: "tenants",
      title: "Tenants",
      validate: () => check(["tenants"]),
      content: (
        <div className="grid gap-3">
          {tenants.map((t, i) => (
            <fieldset key={t.key} className="grid gap-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-[13px] font-medium">Person {i + 1}</legend>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex gap-3 text-sm">
                  {(["existing", "new"] as const).map((m) => (
                    <label key={m} className="flex items-center gap-1.5">
                      <input type="radio" name={`mode-${t.key}`} className="size-4 accent-[var(--primary)]" checked={t.mode === m} onChange={() => setTenants(tenants.map((x) => (x.key === t.key ? { ...x, mode: m } : x)))} />
                      {m === "existing" ? "Existing tenant" : "New tenant"}
                    </label>
                  ))}
                </div>
                <label className="ml-auto grid gap-1 text-[13px] font-medium">
                  Role
                  <NativeSelect value={t.role} onChange={(e) => setTenants(tenants.map((x) => (x.key === t.key ? { ...x, role: e.target.value as Role } : x)))} className="w-40">
                    {LEASE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </NativeSelect>
                </label>
                {tenants.length > 1 ? (
                  <Button type="button" variant="ghost" size="icon" aria-label={`Remove person ${i + 1}`} onClick={() => setTenants(tenants.filter((x) => x.key !== t.key))}><Trash2 aria-hidden /></Button>
                ) : null}
              </div>
              {t.mode === "existing" ? (
                <Field label="Tenant" error={err(`tenants.${i}.tenantId`)}>
                  {(a) => (
                    <NativeSelect {...a} value={t.tenantId} onChange={(e) => setTenants(tenants.map((x) => (x.key === t.key ? { ...x, tenantId: e.target.value } : x)))}>
                      <option value="">Choose a tenant</option>
                      {options.tenants.map((o) => <option key={o.id} value={o.id}>{o.name}{o.email ? ` — ${o.email}` : ""}</option>)}
                    </NativeSelect>
                  )}
                </Field>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="First name" error={err(`tenants.${i}.newTenant.firstName`)} required>{(a) => <Input {...a} value={t.firstName} onChange={(e) => setTenants(tenants.map((x) => (x.key === t.key ? { ...x, firstName: e.target.value } : x)))} />}</Field>
                  <Field label="Last name" error={err(`tenants.${i}.newTenant.lastName`)} required>{(a) => <Input {...a} value={t.lastName} onChange={(e) => setTenants(tenants.map((x) => (x.key === t.key ? { ...x, lastName: e.target.value } : x)))} />}</Field>
                  <Field label="Email" error={err(`tenants.${i}.newTenant.email`)}>{(a) => <Input {...a} type="email" value={t.email} onChange={(e) => setTenants(tenants.map((x) => (x.key === t.key ? { ...x, email: e.target.value } : x)))} />}</Field>
                  <Field label="Phone">{(a) => <Input {...a} type="tel" value={t.phone} onChange={(e) => setTenants(tenants.map((x) => (x.key === t.key ? { ...x, phone: e.target.value } : x)))} />}</Field>
                </div>
              )}
            </fieldset>
          ))}
          {err("tenants") ? <p role="alert" className="text-xs font-medium text-danger">{err("tenants")}</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="secondary" size="sm" onClick={() => setTenants([...tenants, { key: k(), mode: "new", tenantId: "", role: "COTENANT", firstName: "", lastName: "", email: "", phone: "" }])}>
              <UserPlus aria-hidden /> Add co-tenant
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setTenants([...tenants, { key: k(), mode: "new", tenantId: "", role: "COSIGNER", firstName: "", lastName: "", email: "", phone: "" }])}>
              Add cosigner
            </Button>
          </div>
        </div>
      ),
    },
    {
      id: "rent",
      title: "Rent & deposit",
      validate: () => check(["recurring", "deposit"]),
      content: (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Monthly rent" error={err("recurring")} required>
              {(a) => <MoneyInput {...a} valueCents={rentCents} onChangeCents={setRentCents} />}
            </Field>
            <div className="rounded-lg border border-border bg-surface-muted/40 p-3 text-sm" aria-live="polite">
              <div className="mb-1 text-xs font-medium text-muted-foreground">Proration preview</div>
              {rentPreview.length ? (
                <ul className="space-y-1">
                  {rentPreview.map((r) => (
                    <li key={r.label} className="flex justify-between gap-2"><span>{r.label} <span className="text-xs text-muted-foreground">· {r.detail}</span></span><span className="tabular font-medium">{formatMoney(r.amount)}</span></li>
                  ))}
                </ul>
              ) : <p className="text-muted-foreground">Enter rent and a start date.</p>}
            </div>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Other monthly charges</legend>
            {others.map((o, i) => (
              <div key={o.key} className="grid gap-2 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end">
                <label className="grid gap-1 text-xs font-medium">Description<Input value={o.description} onChange={(e) => setOthers(others.map((x) => (x.key === o.key ? { ...x, description: e.target.value } : x)))} /></label>
                <label className="grid gap-1 text-xs font-medium">Account
                  <NativeSelect value={o.accountId} onChange={(e) => setOthers(others.map((x) => (x.key === o.key ? { ...x, accountId: e.target.value } : x)))}>
                    {options.incomeAccounts.map((acc) => <option key={acc.id} value={acc.id}>{acc.label}</option>)}
                  </NativeSelect>
                </label>
                <label className="grid gap-1 text-xs font-medium">Amount<MoneyInput valueCents={o.amountCents} onChangeCents={(c) => setOthers(others.map((x) => (x.key === o.key ? { ...x, amountCents: c } : x)))} /></label>
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove charge ${i + 1}`} onClick={() => setOthers(others.filter((x) => x.key !== o.key))}><Trash2 aria-hidden /></Button>
              </div>
            ))}
            <div>
              <Button type="button" variant="secondary" size="sm" onClick={() => setOthers([...others, { key: k(), accountId: options.incomeAccounts.find((x) => x.systemKey === "OTHER_INCOME")?.id ?? options.rentAccountId, description: "Parking", amountCents: 7500 }])}>
                <Plus aria-hidden /> Add a monthly charge
              </Button>
            </div>
          </fieldset>
          <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
            <legend className="px-1 text-[13px] font-medium">Security deposit</legend>
            <div className="grid gap-1.5 text-sm">
              {([["CHARGE", "Bill it to the tenant"], ["RECEIVED", "Already received"], ["NONE", "No deposit"]] as const).map(([v, l]) => (
                <label key={v} className="flex items-center gap-2"><input type="radio" name="deposit" className="size-4 accent-[var(--primary)]" checked={depositHandling === v} onChange={() => setDepositHandling(v)} /> {l}</label>
              ))}
            </div>
            {depositHandling !== "NONE" ? (
              <Field label="Deposit amount" error={err("deposit.amountCents")}>
                {(a) => <MoneyInput {...a} valueCents={depositCents} onChangeCents={setDepositCents} />}
              </Field>
            ) : null}
          </fieldset>
        </div>
      ),
    },
    {
      id: "settings",
      title: "Settings",
      optional: true,
      content: (
        <div className="grid gap-1">
          <p className="mb-2 text-sm text-muted-foreground">These come from the property and company. Override any of them for just this lease.</p>
          <OverrideRow label="Charge late fees" inherited={inherited?.["lateFees.enabled"]} display={(v) => (v ? "On" : "Off")}
            value={overrides.lateFeesEnabled} onChange={(v) => setOverrides({ ...overrides, lateFeesEnabled: v as boolean | undefined })}
            control={(v, set) => <Switch aria-label="Charge late fees" checked={Boolean(v)} onCheckedChange={set} />} />
          <OverrideRow label="Grace period (days)" inherited={inherited?.["lateFees.graceDays"]} display={(v) => `${String(v)} days`}
            value={overrides.graceDays} onChange={(v) => setOverrides({ ...overrides, graceDays: v as number | undefined })}
            control={(v, set) => <Input aria-label="Grace period days" type="number" min={0} max={31} className="w-20" value={String(v)} onChange={(e) => set(Number(e.target.value))} />} />
          <OverrideRow label="Late fee amount" inherited={inherited?.["lateFees.amountCents"]} display={(v) => formatMoney(Number(v))}
            value={overrides.lateFeeCents} onChange={(v) => setOverrides({ ...overrides, lateFeeCents: v as number | undefined })}
            control={(v, set) => <div className="w-32"><MoneyInput aria-label="Late fee amount" valueCents={Number(v)} onChangeCents={(c) => set(c ?? 0)} /></div>} />
          <OverrideRow label="Allow partial payments" inherited={inherited?.["tenantPortal.allowPartialPayments"]} display={(v) => (v ? "Allowed" : "Not allowed")}
            value={overrides.partialPayments} onChange={(v) => setOverrides({ ...overrides, partialPayments: v as boolean | undefined })}
            control={(v, set) => <Switch aria-label="Allow partial payments" checked={Boolean(v)} onCheckedChange={set} />} />
        </div>
      ),
    },
    ...(!startedInPast
      ? [{
          id: "documents",
          title: "Documents",
          optional: true,
          content: (
            <fieldset className="grid gap-2 text-sm">
              <legend className="mb-2 text-muted-foreground">How will the lease be signed?</legend>
              <label className="flex items-start gap-2"><input type="radio" name="docs" className="mt-0.5 size-4 accent-[var(--primary)]" checked={documents === "OFFLINE"} onChange={() => setDocuments("OFFLINE")} /><span><span className="font-medium">Track signatures offline</span><br /><span className="text-muted-foreground">Upload the signed lease to the lease&apos;s Files tab.</span></span></label>
              <label className="flex items-start gap-2"><input type="radio" name="docs" className="mt-0.5 size-4 accent-[var(--primary)]" checked={documents === "ESIGN"} onChange={() => setDocuments("ESIGN")} /><span><span className="font-medium">Send for e-signature</span><br /><span className="text-muted-foreground">Emails each tenant (and you) a secure signing link using your default lease template. Every view and signature is recorded.</span></span></label>
              <label className="flex items-start gap-2"><input type="radio" name="docs" className="mt-0.5 size-4 accent-[var(--primary)]" checked={documents === "NONE"} onChange={() => setDocuments("NONE")} /><span className="font-medium">Skip for now</span></label>
            </fieldset>
          ),
        } satisfies WizardStep]
      : []),
    {
      id: "portal",
      title: "Portal invite",
      optional: true,
      content: (
        <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
          <Switch checked={portalInvite} onCheckedChange={setPortalInvite} aria-label="Invite tenants to the tenant portal" />
          <span><span className="font-medium">Invite tenants to the tenant portal</span><br /><span className="text-muted-foreground">Tenants with an email address get an invitation to pay rent, set up autopay and send requests online.</span></span>
        </label>
      ),
    },
    {
      id: "review",
      title: "Review",
      validate: () => {
        const r = leaseWizardSchema.safeParse(payload());
        return r.success ? null : (r.error.issues[0]?.message ?? "Check the earlier steps");
      },
      content: (
        <div className="grid gap-4">
          <dl className="divide-y divide-border rounded-lg border border-border text-sm">
            {[
              ["Unit", property ? `${property.name} · ${property.units.filter((u) => unitIds.includes(u.id)).map((u) => u.name).join(", ")}` : "—"],
              ["Term", termType === "FIXED" ? `${formatDate(startDate)} – ${formatDate(endDate)}` : `Month-to-month from ${formatDate(startDate)}`],
              ["Tenants", tenants.map((t) => `${t.mode === "existing" ? (options.tenants.find((o) => o.id === t.tenantId)?.name ?? "?") : `${t.firstName} ${t.lastName}`} (${ROLE_LABEL[t.role]})`).join(", ")],
              ["Rent", `${formatMoney(rentCents ?? 0)} / month, due on day ${rentDueDay}`],
              ["Other charges", others.length ? others.map((o) => `${o.description} ${formatMoney(o.amountCents ?? 0)}`).join(", ") : "None"],
              ["Deposit", depositHandling === "NONE" ? "None" : `${formatMoney(depositCents ?? 0)} — ${depositHandling === "CHARGE" ? "billed to tenant" : "already received"}`],
              ["Overrides", Object.keys(payload().overrides ?? {}).length ? `${Object.keys(payload().overrides ?? {}).length} lease-level` : "None — inherits property settings"],
            ].map(([a, b]) => (
              <div key={a} className="grid gap-1 px-4 py-2.5 sm:grid-cols-3"><dt className="text-muted-foreground">{a}</dt><dd className="sm:col-span-2">{b}</dd></div>
            ))}
          </dl>
          <fieldset className="grid gap-1.5 text-sm">
            <legend className="mb-1 text-[13px] font-medium">When I finish</legend>
            <label className="flex items-center gap-2"><input type="radio" name="status" className="size-4 accent-[var(--primary)]" checked={status === "ACTIVE"} onChange={() => setStatus("ACTIVE")} /> Activate the lease (posts the deposit and rent through today)</label>
            <label className="flex items-center gap-2"><input type="radio" name="status" className="size-4 accent-[var(--primary)]" checked={status === "DRAFT"} onChange={() => setStatus("DRAFT")} /> Save as a draft</label>
          </fieldset>
          {startedInPast && status === "ACTIVE" ? (
            <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-soft-foreground">This lease started in the past, so rent from {formatDate(startDate)} through today will be charged now.</p>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Wizard
        steps={steps}
        finishLabel={status === "ACTIVE" ? "Create lease" : "Save draft"}
        onCancel={close}
        onFinish={async () => {
          const r = await createLease(payload(), preset?.applicationId);
          if (!r.ok) {
            const overlap = r.fieldErrors?.unitIds?.startsWith("overlap:") ? r.fieldErrors.unitIds.slice(8) : null;
            if (overlap) setOverlapLeaseId(overlap);
            toast.error(r.error);
            return;
          }
          toast.success(status === "ACTIVE" ? "Lease created" : "Draft lease saved", documents === "ESIGN" && !r.data.esignError ? { description: "Sent to tenants for e-signature." } : undefined);
          if (r.data.esignError) toast.warning(`Not sent for e-signature: ${r.data.esignError}`);
          router.push(`/app/leasing/${r.data.id}`);
          router.refresh();
        }}
      />
    </div>
  );
}

function OverrideRow({
  label, inherited, display, value, onChange, control,
}: {
  label: string;
  inherited?: { value: unknown; source: string };
  display: (v: unknown) => string;
  value: unknown;
  onChange: (v: unknown) => void;
  control: (v: unknown, set: (v: unknown) => void) => React.ReactNode;
}) {
  const on = value !== undefined;
  const src = inherited?.source === "PROPERTY" ? "property" : inherited?.source === "ORG" ? "company" : "default";
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-border py-3 last:border-0">
      <div className="min-w-48 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <Badge tone={on ? "primary" : "outline"} className="mt-1">{on ? "Custom lease value" : `Inherited from ${src}: ${inherited ? display(inherited.value) : "—"}`}</Badge>
      </div>
      <div className={cn(!on && "pointer-events-none opacity-50")} aria-hidden={!on || undefined}>{control(on ? value : inherited?.value, onChange)}</div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Switch checked={on} onCheckedChange={(c) => onChange(c ? inherited?.value : undefined)} aria-label={`Override ${label}`} />
        Override
      </label>
    </div>
  );
}
