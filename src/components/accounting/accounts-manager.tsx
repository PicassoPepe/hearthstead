"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Lock, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/money";
import { saveAccount } from "@/server/actions/accounting";

export type AccountView = { id: string; code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE"; isBank: boolean; isSystem: boolean; active: boolean; balanceCents: number };
const TYPES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"] as const;
const LABEL: Record<(typeof TYPES)[number], string> = { ASSET: "Assets", LIABILITY: "Liabilities", EQUITY: "Equity", INCOME: "Income", EXPENSE: "Expenses" };

export function AccountsManager({ accounts, canEdit }: { accounts: AccountView[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<AccountView | "new" | null>(null);
  const [v, setV] = React.useState({ code: "", name: "", type: "EXPENSE" as AccountView["type"], isBank: false, active: true });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const open = (a: AccountView | "new") => {
    setEditing(a);
    setErrors({});
    setV(a === "new" ? { code: "", name: "", type: "EXPENSE", isBank: false, active: true } : { code: a.code, name: a.name, type: a.type, isBank: a.isBank, active: a.active });
  };
  const sys = editing !== null && editing !== "new" && editing.isSystem;

  return (
    <>
      {canEdit ? <Button className="mb-4" onClick={() => open("new")}><Plus aria-hidden /> New account</Button> : null}
      <div className="grid gap-4">
        {TYPES.map((t) => {
          const list = accounts.filter((a) => a.type === t);
          return (
            <section key={t} aria-labelledby={`h-${t}`} className="rounded-card border border-border bg-surface shadow-card">
              <h2 id={`h-${t}`} className="flex justify-between border-b border-border px-4 py-2.5 text-sm font-semibold">
                {LABEL[t]}
                <span className="tabular text-muted-foreground">{formatMoney(list.reduce((s, a) => s + a.balanceCents, 0))}</span>
              </h2>
              <table className="w-full text-sm">
                <caption className="sr-only">{LABEL[t]} accounts</caption>
                <thead className="sr-only"><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Balance</th><th scope="col">Actions</th></tr></thead>
                <tbody>
                  {list.map((a) => (
                    <tr key={a.id} className={`border-t border-border first:border-0 ${a.active ? "" : "text-muted-foreground"}`}>
                      <td className="w-20 px-4 py-2 tabular">{a.code}</td>
                      <td className="px-4 py-2">
                        {a.name}
                        {a.isBank ? <Badge tone="info" className="ml-2">Bank</Badge> : null}
                        {a.isSystem ? <Lock className="ml-2 inline size-3.5 text-muted-foreground" aria-label="System account" /> : null}
                        {!a.active ? <Badge tone="outline" className="ml-2">Inactive</Badge> : null}
                      </td>
                      <td className="px-4 py-2 text-right tabular">{formatMoney(a.balanceCents)}</td>
                      <td className="w-12 px-2 py-2">
                        {canEdit ? <Button variant="ghost" size="icon-sm" aria-label={`Edit ${a.name}`} onClick={() => open(a)}><Pencil aria-hidden /></Button> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          );
        })}
      </div>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent aria-describedby="acct-desc">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New account" : "Edit account"}</DialogTitle>
            <DialogDescription id="acct-desc">{sys ? "System accounts are used by the ledger. You can rename or renumber them only." : "Accounts with transactions can't change type."}</DialogDescription>
          </DialogHeader>
          <form
            className="contents"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await saveAccount(editing === "new" ? null : editing!.id, v);
              setBusy(false);
              if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
              toast.success(r.message ?? "Saved");
              setEditing(null);
              router.refresh();
            }}
          >
            <DialogBody className="grid gap-4 sm:grid-cols-3">
              <Field label="Code" error={errors.code} required>{(a) => <Input {...a} inputMode="numeric" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} />}</Field>
              <Field label="Name" error={errors.name} required className="sm:col-span-2">{(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}</Field>
              <Field label="Type" className="sm:col-span-2">
                {(a) => (
                  <NativeSelect {...a} disabled={sys} value={v.type} onChange={(e) => setV({ ...v, type: e.target.value as AccountView["type"] })}>
                    {TYPES.map((t) => <option key={t} value={t}>{LABEL[t].replace(/s$/, "")}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <div className="grid gap-2 self-end pb-1 text-sm">
                <label className="flex items-center gap-2"><Switch disabled={sys || v.type !== "ASSET"} checked={v.isBank} onCheckedChange={(c) => setV({ ...v, isBank: c })} aria-label="Bank account" /> Bank account</label>
                <label className="flex items-center gap-2"><Switch disabled={sys} checked={v.active} onCheckedChange={(c) => setV({ ...v, active: c })} aria-label="Active" /> Active</label>
              </div>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" loading={busy}>Save account</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
