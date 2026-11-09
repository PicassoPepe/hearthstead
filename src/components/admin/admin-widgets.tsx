"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { AdminAction } from "./admin-action";
import { setFlagAction, startImpersonationAction } from "@/server/actions/admin";

/** "View as": open the staff app as this person, for a limited time, with a reason. */
export function ViewAsButton({ orgId, userId, name }: { orgId: string; userId: string; name: string }) {
  const [minutes, setMinutes] = React.useState("30");
  return (
    <AdminAction label="View as" title={`View the app as ${name}`} needsCode
      description="You'll see exactly what they see and can act for them. A banner stays on screen, it ends automatically, and every change is recorded as made by you."
      action={(reason, code) => startImpersonationAction(orgId, userId, reason, code, Number(minutes))}
      after={() => { window.location.assign("/app/overview"); }}>
      <Field label="For how long?">{(a) => (
        <NativeSelect {...a} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="w-40">
          <option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option>
        </NativeSelect>
      )}</Field>
    </AdminAction>
  );
}

/** On / off / back-to-default for one switch (global when orgId is null). */
export function FlagSwitch({ flagKey, label, orgId, on, overridden }: { flagKey: string; label: string; orgId: string | null; on: boolean; overridden: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const set = async (v: boolean | null) => {
    setBusy(true);
    const r = await setFlagAction(flagKey, orgId, v);
    setBusy(false);
    if (!r.ok) return void toast.error(r.error);
    toast.success(r.message ?? "Saved");
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5">
      <span><span className="font-medium">{label}</span> <span className="text-xs text-muted-foreground">({flagKey}) — {on ? "on" : "off"}{overridden ? (orgId ? ", set for this company" : ", set for everyone") : ", default"}</span></span>
      <span className="flex gap-1">
        <Button size="sm" variant={on && overridden ? "primary" : "secondary"} disabled={busy} onClick={() => set(true)}>On</Button>
        <Button size="sm" variant={!on && overridden ? "danger" : "secondary"} disabled={busy} onClick={() => set(false)}>Off</Button>
        {overridden ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => set(null)}>Use default</Button> : null}
      </span>
    </div>
  );
}

/** Add a switch for one company by its web name. */
export function NewFlagOverride({ flags }: { flags: { key: string; label: string }[] }) {
  const router = useRouter();
  const [key, setKey] = React.useState(flags[0]?.key ?? "");
  const [orgId, setOrgId] = React.useState("");
  const [enabled, setEnabled] = React.useState("false");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault();
      const r = await setFlagAction(key, orgId.trim() || null, enabled === "true");
      if (!r.ok) return void toast.error(r.error);
      toast.success("Saved");
      router.refresh();
    }}>
      <Field label="Switch">{(a) => <Input {...a} list="flag-keys" value={key} onChange={(e) => setKey(e.target.value)} className="w-44" />}</Field>
      <datalist id="flag-keys">{flags.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</datalist>
      <Field label="Company ID (empty = everyone)">{(a) => <Input {...a} value={orgId} onChange={(e) => setOrgId(e.target.value)} className="w-72" />}</Field>
      <Field label="Set to">{(a) => <NativeSelect {...a} value={enabled} onChange={(e) => setEnabled(e.target.value)} className="w-28"><option value="true">On</option><option value="false">Off</option></NativeSelect>}</Field>
      <Button type="submit">Save</Button>
    </form>
  );
}

/** Make a company free (beta / partner) with a reason and an optional end date. */
export function CompButton({ orgId, action }: { orgId: string; action: (orgId: string, v: { reason: string; until: string | null; kind?: "COMPLIMENTARY" | "BETA" }) => Promise<import("@/server/action-result").ActionResult<void>> }) {
  const [until, setUntil] = React.useState("");
  const [kind, setKind] = React.useState<"BETA" | "COMPLIMENTARY">("BETA");
  return (
    <AdminAction label="Make free (beta)" title="Make this company free"
      description="They can use DeedWood without a card. If you pick an end date, they get a 14-day trial after it to choose a plan. Nothing is ever deleted."
      action={(reason) => action(orgId, { reason, until: until || null, kind })}>
      <Field label="Type">{(a) => (
        <NativeSelect {...a} value={kind} onChange={(e) => setKind(e.target.value as "BETA" | "COMPLIMENTARY")} className="w-56">
          <option value="BETA">Beta tester</option><option value="COMPLIMENTARY">Complimentary (partner, friend…)</option>
        </NativeSelect>
      )}</Field>
      <Field label="Free until (optional)" description="Leave empty for no end date.">{(a) => <Input {...a} type="date" className="w-48" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>
    </AdminAction>
  );
}
