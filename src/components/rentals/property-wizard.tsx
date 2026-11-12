"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building, Building2, Copy, Home, Landmark, Plus, Store, Trash2, Users, Factory } from "lucide-react";
import { Wizard, type WizardStep } from "@/components/patterns/wizard";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AddressAutocomplete } from "./address-autocomplete";
import { createOwner, createProperty } from "@/server/actions/rentals";
import { formatMoney, sumCents } from "@/lib/money";
import {
  PROPERTY_TYPES,
  PROPERTY_TYPE_META,
  US_STATES,
  formatAddress,
  formatPercentBps,
  nextUnitName,
  parseBaths,
  parsePercentToBps,
  propertyWizardSchema,
  type PropertyTypeKey,
  type PropertyWizardInput,
} from "@/lib/rentals";
import { allocateCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { useCreateModal } from "@/components/create/create-modal";

type UnitRow = { key: string; name: string; beds: string; baths: string; sqft: string; rentCents: number | null };
type OwnerRow = { ownerId: string; percent: string };
type Draft = {
  type: PropertyTypeKey | "";
  name: string;
  portfolioId: string;
  address: { addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string };
  yearBuilt: string;
  units: UnitRow[];
  defaultOperatingAccountId: string;
  defaultDepositAccountId: string;
  reserveCents: number;
  owners: OwnerRow[];
};

export type WizardOptions = {
  orgId: string;
  portfolios: { id: string; name: string }[];
  bankAccounts: { id: string; label: string; purpose: string; systemKey: string | null }[];
  owners: { id: string; name: string }[];
  /** Online payments are switched on. When they aren't, the bank step is hidden. */
  paymentsOn: boolean;
};

const TYPE_ICON: Record<PropertyTypeKey, typeof Home> = {
  SINGLE_FAMILY: Home,
  MULTI_FAMILY: Building2,
  CONDO: Building,
  TOWNHOME: Home,
  COMMERCIAL_OFFICE: Landmark,
  COMMERCIAL_RETAIL: Store,
  COMMERCIAL_INDUSTRIAL: Factory,
  HOA: Users,
};

let keySeq = 0;
const newKey = () => `u${Date.now().toString(36)}${keySeq++}`;
const blankUnit = (name: string, from?: UnitRow): UnitRow => ({ key: newKey(), name, beds: from?.beds ?? "", baths: from?.baths ?? "", sqft: from?.sqft ?? "", rentCents: from?.rentCents ?? null });

function initialDraft(opts: WizardOptions): Draft {
  const op = opts.paymentsOn ? (opts.bankAccounts.find((b) => b.systemKey === "OPERATING_CASH") ?? opts.bankAccounts.find((b) => b.purpose !== "SECURITY_DEPOSIT")) : undefined;
  const dep = opts.paymentsOn ? (opts.bankAccounts.find((b) => b.systemKey === "DEPOSIT_CASH") ?? opts.bankAccounts.find((b) => b.purpose === "SECURITY_DEPOSIT")) : undefined;
  return {
    type: "",
    name: "",
    portfolioId: "",
    address: { addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "" },
    yearBuilt: "",
    units: [],
    defaultOperatingAccountId: op?.id ?? "",
    defaultDepositAccountId: dep?.id ?? "",
    reserveCents: 0,
    owners: [],
  };
}

const intOrNull = (s: string) => (s.trim() === "" ? null : /^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);

/** Turn the editable draft into the API payload (NaN marks invalid numbers for the schema). */
function toPayload(d: Draft, includeBanks = true): PropertyWizardInput {
  return {
    type: (d.type || undefined) as PropertyTypeKey,
    name: d.name,
    portfolioId: d.portfolioId || null,
    address: { ...d.address, state: d.address.state as (typeof US_STATES)[number] },
    yearBuilt: intOrNull(d.yearBuilt),
    units: d.units.map((u) => ({
      name: u.name,
      beds: intOrNull(u.beds),
      bathsTenths: u.baths.trim() === "" ? null : (parseBaths(u.baths) ?? NaN),
      sqft: intOrNull(u.sqft),
      marketRentCents: u.rentCents ?? 0,
      amenities: [],
    })),
    defaultOperatingAccountId: includeBanks ? d.defaultOperatingAccountId || null : null,
    defaultDepositAccountId: includeBanks ? d.defaultDepositAccountId || null : null,
    reserveCents: d.reserveCents,
    owners: d.owners.filter((o) => o.ownerId).map((o) => ({ ownerId: o.ownerId, percentBps: parsePercentToBps(o.percent) ?? -1 })),
  };
}

const STEP_PATHS: Record<string, string[]> = {
  type: ["type"],
  address: ["name", "address", "yearBuilt", "portfolioId"],
  units: ["units"],
  bank: ["defaultOperatingAccountId", "defaultDepositAccountId", "reserveCents"],
  owners: ["owners"],
};

export function PropertyWizard({ options }: { options: WizardOptions }) {
  const router = useRouter();
  const modal = useCreateModal();
  const onClose = modal ? modal.close : () => router.push("/app/rentals");
  const draftKey = `hs.draft.property.${options.orgId}`;
  const [d, setD] = React.useState<Draft>(() => initialDraft(options));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [restored, setRestored] = React.useState(false);
  const [ownerList, setOwnerList] = React.useState(options.owners);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        setD({ ...initialDraft(options), ...(JSON.parse(raw) as Draft) });
        setRestored(true);
      }
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const setAddr = (k: keyof Draft["address"], v: string) => setD((p) => ({ ...p, address: { ...p.address, [k]: v } }));
  const setUnit = (key: string, patch: Partial<UnitRow>) => setD((p) => ({ ...p, units: p.units.map((u) => (u.key === key ? { ...u, ...patch } : u)) }));

  const validateStep = (stepId: string): string | null => {
    const res = propertyWizardSchema.safeParse(toPayload(d, options.paymentsOn));
    const prefixes = STEP_PATHS[stepId] ?? [];
    const errs: Record<string, string> = {};
    if (!res.success) {
      for (const i of res.error.issues) {
        const path = i.path.join(".");
        if (prefixes.some((p) => path === p || path.startsWith(p + "."))) errs[path] ??= i.message;
      }
    }
    setErrors((prev) => {
      const kept = Object.fromEntries(Object.entries(prev).filter(([k]) => !prefixes.some((p) => k === p || k.startsWith(p + "."))));
      return { ...kept, ...errs };
    });
    const n = Object.keys(errs).length;
    return n ? (errs[prefixes[0]!] ?? errs["units"] ?? errs["owners"] ?? `Fix ${n} highlighted field${n === 1 ? "" : "s"} to continue.`) : null;
  };

  const chooseType = (t: PropertyTypeKey) => {
    setD((p) => {
      const single = PROPERTY_TYPE_META[t].singleUnit;
      let units = p.units;
      if (single) units = [p.units[0] ? { ...p.units[0], name: p.units[0].name || "Main" } : blankUnit("Main")];
      else if (units.length === 0) units = [blankUnit("101")];
      return { ...p, type: t, units };
    });
    setErrors((e) => ({ ...e, type: "" }));
  };

  const err = (path: string) => errors[path] || undefined;
  const single = d.type ? PROPERTY_TYPE_META[d.type].singleUnit : false;
  const ownerTotal = d.owners.reduce((s, o) => s + (parsePercentToBps(o.percent) ?? 0), 0);

  const allSteps: WizardStep[] = [
    {
      id: "type",
      title: "Type",
      skippable: true,
      onSkip: () => {
        if (!d.type) setD((p) => ({ ...p, type: "MULTI_FAMILY" }));
      },
      validate: () => validateStep("type"),
      content: (
        <fieldset>
          <legend className="mb-3 text-sm text-muted-foreground">What kind of property is it? Mixed-use buildings are set up as two properties.</legend>
          <div role="radiogroup" aria-label="Property type" className="grid gap-2 sm:grid-cols-2">
            {PROPERTY_TYPES.map((t) => {
              const Icon = TYPE_ICON[t];
              const on = d.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => chooseType(t)}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
                    on ? "border-primary bg-primary-soft/50 ring-1 ring-primary" : "border-border hover:border-border-strong",
                  )}
                >
                  <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                  <span>
                    <span className="block text-sm font-medium">{PROPERTY_TYPE_META[t].label}</span>
                    <span className="block text-xs text-muted-foreground">{PROPERTY_TYPE_META[t].description}</span>
                  </span>
                </button>
              );
            })}
          </div>
          {err("type") ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{err("type")}</p> : null}
        </fieldset>
      ),
    },
    {
      id: "address",
      title: "Address",
      skippable: true,
      validate: () => validateStep("address"),
      content: (
        <div className="grid gap-4 sm:grid-cols-6">
          <Field label="Property name" description="A name or a street address is enough. Everything else can wait." error={err("name")} className="sm:col-span-6">
            {(a) => <Input {...a} value={d.name} onChange={(e) => set("name", e.target.value)} />}
          </Field>
          <Field label="Street address" error={err("address.addressLine1")} className="sm:col-span-4">
            {(a) => (
              <AddressAutocomplete
                id={a.id}
                describedBy={a["aria-describedby"]}
                invalid={a["aria-invalid"]}
                value={d.address.addressLine1}
                onChange={(v) => setAddr("addressLine1", v)}
                onPick={(s) => {
                  setD((p) => ({ ...p, name: p.name || s.addressLine1, address: { ...p.address, addressLine1: s.addressLine1, city: s.city, state: s.state, postalCode: s.postalCode } }));
                }}
              />
            )}
          </Field>
          <Field label="Apt / suite" error={err("address.addressLine2")} className="sm:col-span-2">
            {(a) => <Input {...a} value={d.address.addressLine2} onChange={(e) => setAddr("addressLine2", e.target.value)} />}
          </Field>
          <Field label="City" error={err("address.city")} className="sm:col-span-3">
            {(a) => <Input {...a} autoComplete="address-level2" value={d.address.city} onChange={(e) => setAddr("city", e.target.value)} />}
          </Field>
          <Field label="State" error={err("address.state")} className="sm:col-span-1">
            {(a) => (
              <NativeSelect {...a} value={d.address.state} onChange={(e) => setAddr("state", e.target.value)}>
                <option value="">—</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="ZIP" error={err("address.postalCode")} className="sm:col-span-2">
            {(a) => <Input {...a} inputMode="numeric" autoComplete="postal-code" value={d.address.postalCode} onChange={(e) => setAddr("postalCode", e.target.value)} />}
          </Field>
          <Field label="Portfolio" description="Group properties for reporting and filters." className="sm:col-span-3">
            {(a) => (
              <NativeSelect {...a} value={d.portfolioId} onChange={(e) => set("portfolioId", e.target.value)}>
                <option value="">No portfolio</option>
                {options.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Year built" error={err("yearBuilt")} className="sm:col-span-3">
            {(a) => <Input {...a} inputMode="numeric" value={d.yearBuilt} onChange={(e) => set("yearBuilt", e.target.value)} />}
          </Field>
        </div>
      ),
    },
    {
      id: "units",
      title: "Units",
      skippable: true,
      onSkip: () => setD((p) => ({ ...p, units: p.units.filter((u) => u.name.trim()) })),
      validate: () => validateStep("units"),
      content: (
        <div>
          {single ? (
            <p className="mb-3 rounded-lg bg-info-soft px-3 py-2 text-sm text-info-soft-foreground">Single-family homes have exactly one unit — we created it for you. Remove it if you&apos;d rather add the unit later.</p>
          ) : (
            <p className="mb-3 text-sm text-muted-foreground">Add rentable units if you know them. A unit only needs a name, and you can add more later.</p>
          )}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">Units</caption>
              <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-2 py-2 font-medium">Unit name</th>
                  <th scope="col" className="w-20 px-2 py-2 font-medium">Beds</th>
                  <th scope="col" className="w-20 px-2 py-2 font-medium">Baths</th>
                  <th scope="col" className="w-24 px-2 py-2 font-medium">Sq ft</th>
                  <th scope="col" className="w-36 px-2 py-2 font-medium">Market rent</th>
                  <th scope="col" className="w-20 px-2 py-2"><span className="sr-only">Row actions</span></th>
                </tr>
              </thead>
              <tbody>
                {d.units.map((u, i) => {
                  const e = (f: string) => err(`units.${i}.${f}`);
                  const label = u.name || `row ${i + 1}`;
                  return (
                    <tr key={u.key} className="border-t border-border align-top">
                      <td className="px-2 py-1.5">
                        <Input aria-label={`Unit name, row ${i + 1}`} aria-invalid={!!e("name") || undefined} value={u.name} onChange={(ev) => setUnit(u.key, { name: ev.target.value })} />
                        {e("name") ? <p className="mt-1 text-xs text-danger">{e("name")}</p> : null}
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`Beds, ${label}`} inputMode="numeric" aria-invalid={!!e("beds") || undefined} value={u.beds} onChange={(ev) => setUnit(u.key, { beds: ev.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`Baths, ${label}`} inputMode="decimal" placeholder="1.5" aria-invalid={!!e("bathsTenths") || undefined} value={u.baths} onChange={(ev) => setUnit(u.key, { baths: ev.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Input aria-label={`Square feet, ${label}`} inputMode="numeric" aria-invalid={!!e("sqft") || undefined} value={u.sqft} onChange={(ev) => setUnit(u.key, { sqft: ev.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <MoneyInput aria-label={`Market rent, ${label}`} valueCents={u.rentCents} onChangeCents={(c) => setUnit(u.key, { rentCents: c })} />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {!single ? (
                          <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Duplicate ${label}`}
                              onClick={() =>
                                setD((p) => {
                                  const copy = blankUnit(nextUnitName(p.units.map((x) => x.name)), u);
                                  const units = [...p.units];
                                  units.splice(i + 1, 0, copy);
                                  return { ...p, units };
                                })
                              }
                            >
                              <Copy aria-hidden />
                            </Button>
                        ) : null}
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} onClick={() => set("units", d.units.filter((x) => x.key !== u.key))}>
                              <Trash2 aria-hidden />
                            </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {err("units") ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{err("units")}</p> : null}
          {!single ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={() => set("units", [...d.units, blankUnit(nextUnitName(d.units.map((u) => u.name)), d.units.at(-1))])}>
                <Plus aria-hidden /> Add unit
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const units = [...d.units];
                  for (let k = 0; k < 5; k++) units.push(blankUnit(nextUnitName(units.map((u) => u.name)), units.at(-1)));
                  set("units", units);
                }}
              >
                Add 5 more
              </Button>
              <span className="ml-auto text-xs text-muted-foreground">
                {d.units.length} unit{d.units.length === 1 ? "" : "s"} · {formatMoney(sumCents(d.units.map((u) => u.rentCents ?? 0)))} / mo market rent
              </span>
            </div>
          ) : null}
        </div>
      ),
    },
    {
      id: "bank",
      title: "Bank accounts",
      optional: true,
      skippable: true,
      onSkip: () => setD((p) => ({ ...p, defaultOperatingAccountId: "", defaultDepositAccountId: "", reserveCents: 0 })),
      validate: () => validateStep("bank"),
      content: (
        <div className="grid gap-4 sm:grid-cols-2">
          <p className="text-sm text-muted-foreground sm:col-span-2">Optional. These are bookkeeping accounts, not a bank connection. Choose later if you don&apos;t have them yet.</p>
          <Field label="Operating account" description="Rent and expenses for this property post here." error={err("defaultOperatingAccountId")}>
            {(a) => (
              <NativeSelect {...a} value={d.defaultOperatingAccountId} onChange={(e) => set("defaultOperatingAccountId", e.target.value)}>
                <option value="">Choose later</option>
                {options.bankAccounts.filter((b) => b.purpose !== "SECURITY_DEPOSIT").map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Security deposit account" description="Deposits are held separately, as most states require." error={err("defaultDepositAccountId")}>
            {(a) => (
              <NativeSelect {...a} value={d.defaultDepositAccountId} onChange={(e) => set("defaultDepositAccountId", e.target.value)}>
                <option value="">Choose later</option>
                {options.bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Property reserve" description="Cash kept back from owner distributions." error={err("reserveCents")}>
            {(a) => <MoneyInput {...a} valueCents={d.reserveCents} onChangeCents={(c) => set("reserveCents", c ?? 0)} />}
          </Field>
        </div>
      ),
    },
    {
      id: "owners",
      title: "Owners",
      optional: true,
      skippable: true,
      onSkip: () => setD((p) => {
        const rows = p.owners.filter((o) => o.ownerId && parsePercentToBps(o.percent) != null);
        const total = rows.reduce((s, o) => s + (parsePercentToBps(o.percent) ?? 0), 0);
        return { ...p, owners: rows.length > 0 && total === 10_000 ? rows : [] };
      }),
      validate: () => validateStep("owners"),
      content: (
        <OwnersStep
          rows={d.owners}
          owners={ownerList}
          total={ownerTotal}
          error={err("owners")}
          onChange={(rows) => set("owners", rows)}
          onOwnerCreated={(o) => setOwnerList((l) => [...l, o].sort((a, b) => a.name.localeCompare(b.name)))}
        />
      ),
    },
    {
      id: "review",
      title: "Review",
      validate: () => {
        const res = propertyWizardSchema.safeParse(toPayload(d, options.paymentsOn));
        return res.success ? null : (res.error.issues[0]?.message ?? "Check the earlier steps");
      },
      content: <Review d={d} options={options} ownerList={ownerList} />,
    },
  ];
  const steps = options.paymentsOn ? allSteps : allSteps.filter((s) => s.id !== "bank");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {restored ? (
        <div className="flex items-center gap-2 border-b border-border bg-info-soft px-5 py-2 text-sm text-info-soft-foreground" role="status">
          Draft restored.
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => {
              try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
              setD(initialDraft(options));
              setRestored(false);
            }}
          >
            Start over
          </button>
        </div>
      ) : null}
      <Wizard
        steps={steps}
        finishLabel="Create property"
        onCancel={onClose}
        onSaveDraft={() => {
          try { localStorage.setItem(draftKey, JSON.stringify(d)); } catch { /* ignore */ }
          toast.success("Draft saved — it will be here next time you add a property");
          onClose?.();
        }}
        onFinish={async () => {
          const payload = toPayload(d, options.paymentsOn);
          const r = await createProperty(payload);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          try { localStorage.removeItem(draftKey); } catch { /* ignore */ }
          const label = (payload.name ?? "").trim() || payload.address?.addressLine1 || "Property";
          toast.success(`${label} created with ${d.units.length} unit${d.units.length === 1 ? "" : "s"}`);
          router.push(`/app/rentals/${r.data.id}`);
          router.refresh();
        }}
      />
    </div>
  );
}

function OwnersStep({
  rows, owners, total, error, onChange, onOwnerCreated,
}: {
  rows: OwnerRow[];
  owners: { id: string; name: string }[];
  total: number;
  error?: string;
  onChange: (rows: OwnerRow[]) => void;
  onOwnerCreated: (o: { id: string; name: string }) => void;
}) {
  const [quickName, setQuickName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const splitEvenly = () => {
    const parts = allocateCents(10_000, rows.map(() => 1));
    onChange(rows.map((r, i) => ({ ...r, percent: formatPercentBps(parts[i]!).replace("%", "") })));
  };
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Who owns this property? You can skip this and add owners later. Ownership must total 100%.</p>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <Field label={`Owner ${i + 1}`} className="min-w-56 flex-1">
            {(a) => (
              <NativeSelect {...a} value={r.ownerId} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, ownerId: e.target.value } : x)))}>
                <option value="">Choose an owner</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </NativeSelect>
            )}
          </Field>
          <Field label="Share" className="w-28">
            {(a) => (
              <div className="relative">
                <Input {...a} inputMode="decimal" className="pr-7 text-right" value={r.percent} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
                <span aria-hidden className="absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">%</span>
              </div>
            )}
          </Field>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove owner ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
            <Trash2 aria-hidden />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...rows, { ownerId: "", percent: rows.length === 0 ? "100" : "" }])}>
          <Plus aria-hidden /> Add owner
        </Button>
        {rows.length > 1 ? <Button type="button" variant="ghost" size="sm" onClick={splitEvenly}>Split evenly</Button> : null}
        {rows.length ? (
          <Badge tone={total === 10_000 ? "success" : "warning"} className="ml-auto">Total {formatPercentBps(total)}{total === 10_000 ? " ✓" : ""}</Badge>
        ) : null}
      </div>
      {error ? <p role="alert" className="text-xs font-medium text-danger">{error}</p> : null}
      <div className="rounded-lg border border-dashed border-border-strong p-3">
        <p className="mb-2 text-[13px] font-medium">Owner not listed? Create them quickly</p>
        <div className="flex gap-2">
          <Input aria-label="New owner full name or company" placeholder="Full name or company" value={quickName} onChange={(e) => setQuickName(e.target.value)} />
          <Button
            type="button"
            variant="secondary"
            loading={creating}
            onClick={async () => {
              const name = quickName.trim();
              if (name.length < 2) return void toast.error("Enter the owner's name");
              setCreating(true);
              const parts = name.split(/\s+/);
              const company = /\b(llc|inc|corp|trust|lp|ltd|co\.?)\b/i.test(name) || parts.length < 2;
              const r = await createOwner(
                company ? { kind: "COMPANY", companyName: name } : { kind: "PERSON", firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1)! },
              );
              setCreating(false);
              if (!r.ok) return void toast.error(r.error);
              onOwnerCreated({ id: r.data.id, name });
              onChange([...rows, { ownerId: r.data.id, percent: rows.length === 0 ? "100" : "" }]);
              setQuickName("");
              toast.success(`${name} added as an owner`);
            }}
          >
            Create owner
          </Button>
        </div>
      </div>
    </div>
  );
}

function Review({ d, options, ownerList }: { d: Draft; options: WizardOptions; ownerList: { id: string; name: string }[] }) {
  const bank = (id: string) => options.bankAccounts.find((b) => b.id === id)?.label ?? "Not set";
  const rows: [string, React.ReactNode][] = [
    ["Type", d.type ? PROPERTY_TYPE_META[d.type].label : "—"],
    ["Name", d.name || "—"],
    ["Address", formatAddress(d.address)],
    ["Portfolio", options.portfolios.find((p) => p.id === d.portfolioId)?.name ?? "None"],
    ["Units", `${d.units.length} · ${formatMoney(sumCents(d.units.map((u) => u.rentCents ?? 0)))} / mo market rent`],
    ...(options.paymentsOn
      ? ([
          ["Operating account", bank(d.defaultOperatingAccountId)],
          ["Deposit account", bank(d.defaultDepositAccountId)],
          ["Reserve", formatMoney(d.reserveCents)],
        ] as [string, React.ReactNode][])
      : []),
    ["Owners", d.owners.length ? d.owners.map((o) => `${ownerList.find((x) => x.id === o.ownerId)?.name ?? "?"} (${o.percent}%)`).join(", ") : "None yet"],
  ];
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {rows.map(([k, v]) => (
        <div key={k} className="grid gap-1 px-4 py-2.5 sm:grid-cols-3">
          <dt className="text-[13px] text-muted-foreground">{k}</dt>
          <dd className="text-sm sm:col-span-2">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
