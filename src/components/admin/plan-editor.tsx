"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { savePlanAction } from "@/server/actions/admin";

type PlanRow = Record<string, unknown> & { key: string; mode: string; displayName: string; description: string; active: boolean; published: boolean; features: string[] };

const MONEY: [string, string][] = [
  ["monthlyFlatCents", "Monthly flat"], ["monthlyPerUnitCents", "Monthly per unit"], ["monthlyMinCents", "Monthly minimum"],
  ["annualFlatCents", "Yearly flat"], ["annualPerUnitCents", "Yearly per unit"], ["annualMinCents", "Yearly minimum"],
  ["volumeMonthlyCents", "Monthly per unit above volume"], ["volumeAnnualCents", "Yearly per unit above volume"], ["addOnAnnualCents", "Yearly add-on"],
];
const dollars = (c: unknown) => (typeof c === "number" ? (c / 100).toFixed(2).replace(/\.00$/, "") : "");
const cents = (s: string) => (s.trim() === "" ? null : Math.round(Number(s.replace(/[$,]/g, "")) * 100));

export function PlanEditor({ plan, subscribers, examples }: { plan: PlanRow; subscribers: number; examples: string[] }) {
  const router = useRouter();
  const [v, setV] = React.useState<Record<string, string>>(() => ({
    displayName: plan.displayName, description: plan.description,
    ...Object.fromEntries(MONEY.map(([k]) => [k, dollars(plan[k])])),
    unitMin: String(plan.unitMin ?? 0), unitMax: plan.unitMax == null ? "" : String(plan.unitMax), volumeAboveUnits: plan.volumeAboveUnits == null ? "" : String(plan.volumeAboveUnits),
    smsIncluded: String(plan.smsIncluded ?? 0), stripePriceMonthId: String(plan.stripePriceMonthId ?? ""), stripePriceYearId: String(plan.stripePriceYearId ?? ""),
  }));
  const [active, setActive] = React.useState(plan.active);
  const [published, setPublished] = React.useState(plan.published);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const int = (s: string) => (s.trim() === "" ? null : Number(s));
  return (
    <form className="grid gap-3 rounded-card border border-border bg-surface p-4 shadow-card" data-testid={`plan-${plan.key}`} onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await savePlanAction(plan.key, {
        displayName: v.displayName, description: v.description, active, published,
        ...Object.fromEntries(MONEY.map(([k]) => [k, cents(v[k] ?? "")])),
        unitMin: int(v.unitMin ?? "") ?? 0, unitMax: int(v.unitMax ?? ""), volumeAboveUnits: int(v.volumeAboveUnits ?? ""), smsIncluded: int(v.smsIncluded ?? "") ?? 0,
        stripePriceMonthId: v.stripePriceMonthId || null, stripePriceYearId: v.stripePriceYearId || null,
      });
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      setErrors({});
      toast.success(`${v.displayName} saved`);
      router.refresh();
    }}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{plan.displayName}</h2>
        <Badge>{plan.mode === "HOSTED" ? "Hosted" : plan.mode === "SELF_HOSTED" ? "Local" : "Add-on"}</Badge>
        <span className="font-mono text-xs text-muted-foreground">{plan.key}</span>
        <span className="text-xs text-muted-foreground">· {subscribers} subscriber{subscribers === 1 ? "" : "s"}</span>
        <label className="ml-auto flex items-center gap-1.5 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> For sale</label>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} /> Shown on pricing page</label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" error={errors.displayName}>{(a) => <Input {...a} value={v.displayName} onChange={(e) => setV({ ...v, displayName: e.target.value })} />}</Field>
        <Field label="Short description">{(a) => <Input {...a} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {MONEY.map(([k, label]) => <Field key={k} label={`${label} ($)`} error={errors[k]}>{(a) => <Input {...a} inputMode="decimal" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}</Field>)}
        <Field label="From units" error={errors.unitMin}>{(a) => <Input {...a} inputMode="numeric" value={v.unitMin} onChange={(e) => setV({ ...v, unitMin: e.target.value })} />}</Field>
        <Field label="Up to units (empty = no limit)" error={errors.unitMax}>{(a) => <Input {...a} inputMode="numeric" value={v.unitMax} onChange={(e) => setV({ ...v, unitMax: e.target.value })} />}</Field>
        <Field label="Volume price starts above (units)" error={errors.volumeAboveUnits}>{(a) => <Input {...a} inputMode="numeric" value={v.volumeAboveUnits} onChange={(e) => setV({ ...v, volumeAboveUnits: e.target.value })} />}</Field>
        <Field label="Texts included / month" error={errors.smsIncluded}>{(a) => <Input {...a} inputMode="numeric" value={v.smsIncluded} onChange={(e) => setV({ ...v, smsIncluded: e.target.value })} />}</Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Stripe monthly price ID" error={errors.stripePriceMonthId}>{(a) => <Input {...a} placeholder="price_…" value={v.stripePriceMonthId} onChange={(e) => setV({ ...v, stripePriceMonthId: e.target.value })} />}</Field>
        <Field label="Stripe yearly price ID" error={errors.stripePriceYearId}>{(a) => <Input {...a} placeholder="price_…" value={v.stripePriceYearId} onChange={(e) => setV({ ...v, stripePriceYearId: e.target.value })} />}</Field>
      </div>
      <p className="text-xs text-muted-foreground">Examples at today&apos;s prices: {examples.join(" · ") || "—"} · Includes: {plan.features.join(", ") || "—"}</p>
      <div><Button type="submit" loading={busy}>Save {plan.displayName}</Button></div>
    </form>
  );
}
