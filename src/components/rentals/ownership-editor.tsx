"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/patterns/empty-state";
import { formatPercentBps, parsePercentToBps } from "@/lib/rentals";
import { allocateCents } from "@/lib/money";
import { saveOwnerships } from "@/server/actions/rentals";

type Row = { ownerId: string; percent: string; agreementStart: string; agreementEnd: string };

export function OwnershipEditor({
  propertyId,
  initial,
  owners,
  canEdit,
}: {
  propertyId: string;
  initial: { ownerId: string; percentBps: number; agreementStart: string | null; agreementEnd: string | null; ownerName: string }[];
  owners: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const toRows = () => initial.map((o) => ({ ownerId: o.ownerId, percent: formatPercentBps(o.percentBps).replace("%", ""), agreementStart: o.agreementStart ?? "", agreementEnd: o.agreementEnd ?? "" }));
  const [editing, setEditing] = React.useState(false);
  const [rows, setRows] = React.useState<Row[]>(toRows);
  const [busy, setBusy] = React.useState(false);
  const total = rows.reduce((s, r) => s + (parsePercentToBps(r.percent) ?? 0), 0);

  if (!editing) {
    if (initial.length === 0) {
      return (
        <EmptyState
          icon={<UserRound />}
          title="No owners linked"
          description="Link owners with their ownership percentage so statements and distributions go to the right people."
          action={canEdit ? <Button onClick={() => { setRows([{ ownerId: "", percent: "100", agreementStart: "", agreementEnd: "" }]); setEditing(true); }}><Plus aria-hidden /> Link owners</Button> : undefined}
        />
      );
    }
    return (
      <div className="rounded-card border border-border bg-surface">
        <table className="w-full text-sm">
          <caption className="sr-only">Owners of this property</caption>
          <thead className="bg-surface-muted/60 text-left text-xs text-muted-foreground">
            <tr><th scope="col" className="px-4 py-2 font-medium">Owner</th><th scope="col" className="px-4 py-2 font-medium">Share</th><th scope="col" className="px-4 py-2 font-medium">Agreement</th></tr>
          </thead>
          <tbody>
            {initial.map((o) => (
              <tr key={o.ownerId} className="border-t border-border">
                <td className="px-4 py-2.5"><Link href={`/app/people/owners/${o.ownerId}`} className="font-medium hover:underline">{o.ownerName}</Link></td>
                <td className="px-4 py-2.5 tabular">{formatPercentBps(o.percentBps)}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{o.agreementStart ?? "—"} → {o.agreementEnd ?? "ongoing"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {canEdit ? <div className="border-t border-border px-4 py-2.5"><Button variant="secondary" size="sm" onClick={() => { setRows(toRows()); setEditing(true); }}>Edit ownership</Button></div> : null}
      </div>
    );
  }

  return (
    <form
      className="grid gap-3 rounded-card border border-border bg-surface p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await saveOwnerships(
          propertyId,
          rows.filter((x) => x.ownerId).map((x) => ({ ownerId: x.ownerId, percentBps: parsePercentToBps(x.percent) ?? -1, agreementStart: x.agreementStart || null, agreementEnd: x.agreementEnd || null })),
        );
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success("Ownership updated");
        setEditing(false);
        router.refresh();
      }}
    >
      {rows.map((r, i) => (
        <fieldset key={i} className="grid gap-2 sm:grid-cols-[1fr_100px_150px_150px_auto] sm:items-end">
          <legend className="sr-only">Owner {i + 1}</legend>
          <label className="grid gap-1 text-[13px] font-medium">Owner
            <NativeSelect value={r.ownerId} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ownerId: e.target.value } : x)))}>
              <option value="">Choose an owner</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-[13px] font-medium">Share %
            <Input inputMode="decimal" className="text-right" value={r.percent} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)))} />
          </label>
          <label className="grid gap-1 text-[13px] font-medium">Agreement start
            <Input type="date" value={r.agreementStart} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, agreementStart: e.target.value } : x)))} />
          </label>
          <label className="grid gap-1 text-[13px] font-medium">Agreement end
            <Input type="date" value={r.agreementEnd} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, agreementEnd: e.target.value } : x)))} />
          </label>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove owner ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={() => setRows([...rows, { ownerId: "", percent: "", agreementStart: "", agreementEnd: "" }])}><Plus aria-hidden /> Add owner</Button>
        {rows.length > 1 ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => { const p = allocateCents(10_000, rows.map(() => 1)); setRows(rows.map((x, i) => ({ ...x, percent: formatPercentBps(p[i]!).replace("%", "") }))); }}>Split evenly</Button>
        ) : null}
        <Badge tone={total === 10_000 || rows.length === 0 ? "success" : "warning"} className="ml-auto">Total {formatPercentBps(total)}</Badge>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
        <Button type="submit" loading={busy}>Save ownership</Button>
      </div>
    </form>
  );
}
