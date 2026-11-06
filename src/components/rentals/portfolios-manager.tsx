"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/patterns/empty-state";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { deletePortfolio, savePortfolio } from "@/server/actions/rentals";
import { formatMoney } from "@/lib/money";

export type PortfolioView = { id: string; name: string; description: string | null; properties: { id: string; name: string }[]; units: number; marketRentCents: number };

export function PortfoliosManager({ rows, canEdit, canDelete }: { rows: PortfolioView[]; canEdit: boolean; canDelete: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<PortfolioView | "new" | null>(null);
  const [deleting, setDeleting] = React.useState<PortfolioView | null>(null);
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);

  const open = (p: PortfolioView | "new") => {
    setEditing(p);
    setName(p === "new" ? "" : p.name);
    setDescription(p === "new" ? "" : (p.description ?? ""));
    setError(undefined);
  };

  return (
    <>
      {canEdit ? <Button className="mb-4" onClick={() => open("new")}><Plus aria-hidden /> New portfolio</Button> : null}
      {rows.length === 0 ? (
        <EmptyState icon={<FolderTree />} title="Group properties into portfolios" description="Portfolios let you filter lists, dashboards and reports — by owner group, region or fund." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">{p.name}</h2>
                  {p.description ? <p className="text-sm text-muted-foreground">{p.description}</p> : null}
                </div>
                <div className="flex">
                  {canEdit ? <Button variant="ghost" size="icon-sm" aria-label={`Edit ${p.name}`} onClick={() => open(p)}><Pencil aria-hidden /></Button> : null}
                  {canDelete ? <Button variant="ghost" size="icon-sm" aria-label={`Delete ${p.name}`} onClick={() => setDeleting(p)}><Trash2 aria-hidden /></Button> : null}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Properties</dt><dd className="tabular font-medium">{p.properties.length}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Units</dt><dd className="tabular font-medium">{p.units}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Market rent</dt><dd className="tabular font-medium">{formatMoney(p.marketRentCents, { showCents: false })}</dd></div>
              </dl>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {p.properties.map((x) => (
                  <li key={x.id}><Link href={`/app/rentals/${x.id}`} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs hover:underline">{x.name}</Link></li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent aria-describedby="pf-desc">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New portfolio" : "Edit portfolio"}</DialogTitle>
            <DialogDescription id="pf-desc">Assign properties to it from each property&apos;s Edit drawer or the New Property wizard.</DialogDescription>
          </DialogHeader>
          <form
            className="contents"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await savePortfolio(editing === "new" ? null : editing!.id, { name, description });
              setBusy(false);
              if (!r.ok) { setError(r.fieldErrors?.name ?? r.error); return; }
              toast.success("Portfolio saved");
              setEditing(null);
              router.refresh();
            }}
          >
            <DialogBody className="grid gap-4">
              <Field label="Name" error={error} required>{(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <Field label="Description">{(a) => <Input {...a} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
              <Button type="submit" loading={busy}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name ?? "portfolio"}?`}
        description="Its properties stay; they just won't belong to a portfolio."
        confirmLabel="Delete portfolio"
        destructive
        onConfirm={async () => {
          const r = await deletePortfolio(deleting!.id);
          setDeleting(null);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Portfolio deleted");
          router.refresh();
        }}
      />
    </>
  );
}
