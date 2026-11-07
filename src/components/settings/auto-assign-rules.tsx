"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/input";
import { CATEGORIES } from "@/lib/maintenance";
import { saveAutoAssignRules } from "@/server/actions/maintenance";

type Rule = { category: string; userId: string | null; vendorId: string | null };

export function AutoAssignRules({ initial, members, vendors, canEdit }: { initial: Rule[]; members: { id: string; name: string }[]; vendors: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [rules, setRules] = React.useState<Rule[]>(initial);
  const [busy, setBusy] = React.useState(false);
  const set = (i: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="grid gap-3">
      {rules.length === 0 ? <p className="text-sm text-muted-foreground">No rules yet. New requests stay unassigned until someone picks them up.</p> : null}
      {rules.map((r, i) => (
        <fieldset key={i} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end" disabled={!canEdit}>
          <legend className="sr-only">Rule {i + 1}</legend>
          <label className="grid gap-1 text-xs font-medium">When category is
            <NativeSelect value={r.category} onChange={(e) => set(i, { category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs font-medium">Assign to
            <NativeSelect value={r.userId ?? ""} onChange={(e) => set(i, { userId: e.target.value || null })}>
              <option value="">Nobody</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1 text-xs font-medium">And vendor
            <NativeSelect value={r.vendorId ?? ""} onChange={(e) => set(i, { vendorId: e.target.value || null })}>
              <option value="">No vendor</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </NativeSelect>
          </label>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove rule ${i + 1}`} onClick={() => setRules(rules.filter((_, j) => j !== i))}><Trash2 aria-hidden /></Button>
        </fieldset>
      ))}
      {canEdit ? (
        <div className="flex gap-2">
          <Button type="button" variant="secondary" onClick={() => setRules([...rules, { category: CATEGORIES.find((c) => !rules.some((r) => r.category === c.value))?.value ?? "GENERAL", userId: members[0]?.id ?? null, vendorId: null }])}><Plus aria-hidden /> Add rule</Button>
          <Button loading={busy} onClick={async () => {
            setBusy(true);
            const r = await saveAutoAssignRules(rules);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Auto-assign rules saved");
            router.refresh();
          }}>Save rules</Button>
        </div>
      ) : null}
    </div>
  );
}
