"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addRecurringChargeAction, changeRecurringChargeAction, endRecurringChargeAction } from "@/server/actions/leasing";

export type RecurringRow = { id: string; kind: "RENT" | "OTHER"; description: string; account: string; amountCents: number; startDate: string; endDate: string | null; nextRunDate: string; status: "Active" | "Scheduled" | "Finished"; earliestChange: string };
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

type Mode = { kind: "add" } | { kind: "change"; row: RecurringRow } | { kind: "end"; row: RecurringRow } | null;

export function RecurringEditor({ leaseId, rows, accounts, canEdit, draft }: { leaseId: string; rows: RecurringRow[]; accounts: { id: string; label: string; systemKey: string | null }[]; canEdit: boolean; draft: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<Mode>(null);
  const [busy, setBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const rentAcct = accounts.find((a) => a.systemKey === "RENT_INCOME")?.id ?? accounts[0]?.id ?? "";
  const [f, setF] = React.useState({ kind: "OTHER" as "RENT" | "OTHER", accountId: rentAcct, description: "", amountCents: null as number | null, startDate: "", endDate: "", effectiveDate: "" });
  const open = (m: Mode) => {
    setErrors({});
    if (m?.kind === "add") setF({ kind: "OTHER", accountId: rentAcct, description: "", amountCents: null, startDate: rows[0]?.earliestChange ?? "", endDate: "", effectiveDate: "" });
    if (m?.kind === "change") setF({ ...f, amountCents: m.row.amountCents, description: m.row.description, effectiveDate: m.row.earliestChange });
    if (m?.kind === "end") setF({ ...f, endDate: m.row.endDate ?? "" });
    setMode(m);
  };
  const run = async (p: Promise<{ ok: boolean; error?: string; fieldErrors?: Record<string, string>; message?: string }>) => {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
    toast.success(r.message ?? "Saved");
    setMode(null);
    router.refresh();
  };

  return (
    <div className="grid gap-2">
      <div className="overflow-x-auto rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Recurring charges</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
            <tr>{["Charge", "Account", "Amount", "Starts", "Ends", "Next posts", ""].map((h, i) => <th key={i} scope="col" className="px-3 py-2 font-medium">{h || <span className="sr-only">Actions</span>}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2 font-medium">{r.description} <Badge tone={r.kind === "RENT" ? "primary" : "neutral"}>{r.kind === "RENT" ? "Rent" : "Other"}</Badge>{r.status !== "Active" ? <Badge tone={r.status === "Scheduled" ? "info" : "neutral"} className="ml-1">{r.status}</Badge> : null}</td>
                <td className="px-3 py-2">{r.account}</td>
                <td className="px-3 py-2 tabular">{money(r.amountCents)} / mo</td>
                <td className="px-3 py-2 tabular">{fmt(r.startDate)}</td>
                <td className="px-3 py-2 tabular">{r.endDate ? fmt(r.endDate) : "—"}</td>
                <td className="px-3 py-2 tabular">{r.status === "Finished" ? "Finished" : draft ? "On activation" : fmt(r.nextRunDate)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  {canEdit && r.status !== "Finished" ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => open({ kind: "change", row: r })} aria-label={`Change ${r.description}`}>Change</Button>
                      <Button size="sm" variant="ghost" onClick={() => open({ kind: "end", row: r })} aria-label={`End ${r.description}`}>End</Button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No recurring charges.</p> : null}
      </div>
      {canEdit ? <div><Button variant="secondary" size="sm" onClick={() => open({ kind: "add" })}><Plus aria-hidden /> Add recurring charge</Button></div> : null}

      <Dialog open={mode !== null} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent aria-describedby="rc-desc">
          <DialogHeader>
            <DialogTitle>{mode?.kind === "add" ? "Add recurring charge" : mode?.kind === "change" ? `Change ${mode.row.description}` : mode?.kind === "end" ? `End ${mode.row.description}` : ""}</DialogTitle>
            <DialogDescription id="rc-desc">
              {mode?.kind === "add" ? "Parking, pet rent, storage, utilities… It posts monthly with rent (prorated for partial months)." : mode?.kind === "change" ? `Months already billed don't change. Earliest effective date: ${fmt(mode.row.earliestChange)}.` : "The last day this charge is billed. Partial months are prorated."}
            </DialogDescription>
          </DialogHeader>
          <form className="contents" noValidate onSubmit={(e) => {
            e.preventDefault();
            if (mode?.kind === "add") void run(addRecurringChargeAction(leaseId, { kind: f.kind, accountId: f.accountId, description: f.description, amountCents: f.amountCents ?? 0, startDate: f.startDate, endDate: f.endDate || null }));
            if (mode?.kind === "change") void run(changeRecurringChargeAction(leaseId, mode.row.id, { amountCents: f.amountCents ?? 0, effectiveDate: f.effectiveDate, description: f.description }));
            if (mode?.kind === "end") void run(endRecurringChargeAction(leaseId, mode.row.id, f.endDate));
          }}>
            <DialogBody className="grid gap-4 sm:grid-cols-2">
              {mode?.kind === "add" ? (
                <>
                  <Field label="Description" required error={errors.description} className="sm:col-span-2">{(a) => <Input {...a} placeholder="e.g. Parking space P12" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
                  <Field label="Type">{(a) => <NativeSelect {...a} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as "RENT" | "OTHER" })}><option value="OTHER">Other charge</option><option value="RENT">Rent</option></NativeSelect>}</Field>
                  <Field label="Income account" error={errors.accountId}>{(a) => <NativeSelect {...a} value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>{accounts.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>}</Field>
                  <Field label="Monthly amount" required error={errors.amountCents}>{(a) => <MoneyInput {...a} valueCents={f.amountCents} onChangeCents={(c) => setF({ ...f, amountCents: c })} />}</Field>
                  <Field label="Starts" required error={errors.startDate}>{(a) => <Input {...a} type="date" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />}</Field>
                  <Field label="Ends (optional)" error={errors.endDate}>{(a) => <Input {...a} type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />}</Field>
                </>
              ) : mode?.kind === "change" ? (
                <>
                  <Field label="New monthly amount" required error={errors.amountCents}>{(a) => <MoneyInput {...a} valueCents={f.amountCents} onChangeCents={(c) => setF({ ...f, amountCents: c })} />}</Field>
                  <Field label="Effective date" required error={errors.effectiveDate}>{(a) => <Input {...a} type="date" min={mode.row.earliestChange} value={f.effectiveDate} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} />}</Field>
                  <Field label="Description" className="sm:col-span-2">{(a) => <Input {...a} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}</Field>
                  <p className="text-sm text-muted-foreground sm:col-span-2">Currently {money(mode.row.amountCents)} / mo{f.amountCents ? ` → ${money(f.amountCents)} (${f.amountCents >= mode.row.amountCents ? "+" : ""}${(((f.amountCents - mode.row.amountCents) / mode.row.amountCents) * 100).toFixed(1)}%)` : ""}</p>
                </>
              ) : mode?.kind === "end" ? (
                <Field label="Last day billed" required error={errors.endDate}>{(a) => <Input {...a} type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />}</Field>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
              <Button type="submit" loading={busy}>{mode?.kind === "add" ? "Add charge" : mode?.kind === "change" ? "Save change" : "End charge"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
