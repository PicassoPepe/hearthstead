"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { setMemberPropertyScope } from "@/server/actions/rentals";

/** "All properties" / "3 properties" button that opens a checklist to scope a member. */
export function PropertyAccessButton({ membershipId, memberName, scope, properties, canEdit }: { membershipId: string; memberName: string; scope: string[]; properties: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [all, setAll] = React.useState(scope.length === 0);
  const [picked, setPicked] = React.useState<Set<string>>(new Set(scope));
  const [busy, setBusy] = React.useState(false);
  const label = scope.length === 0 ? "All properties" : `${scope.length} propert${scope.length === 1 ? "y" : "ies"}`;
  if (!canEdit) return <span className="text-muted-foreground">{label}</span>;
  return (
    <>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-[13px]"
        aria-label={`Property access for ${memberName}: ${label}. Change`}
        onClick={(e) => { e.stopPropagation(); setAll(scope.length === 0); setPicked(new Set(scope)); setOpen(true); }}
      >
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="pa-desc" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Property access for {memberName}</DialogTitle>
            <DialogDescription id="pa-desc">Limit what this person sees to specific properties. Their role still controls what they can do.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            <fieldset className="grid gap-2">
              <legend className="sr-only">Access level</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" className="size-4 accent-[var(--primary)]" checked={all} onChange={() => setAll(true)} /> All properties, including ones added later</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" className="size-4 accent-[var(--primary)]" checked={!all} onChange={() => setAll(false)} /> Only selected properties</label>
            </fieldset>
            {!all ? (
              <fieldset className="max-h-72 overflow-y-auto rounded-lg border border-border p-2">
                <legend className="sr-only">Properties</legend>
                {properties.length === 0 ? <p className="p-2 text-sm text-muted-foreground">No properties yet.</p> : null}
                {properties.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={picked.has(p.id)}
                      onChange={(e) => {
                        const n = new Set(picked);
                        if (e.target.checked) n.add(p.id); else n.delete(p.id);
                        setPicked(n);
                      }}
                    />
                    {p.name}
                  </label>
                ))}
              </fieldset>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={busy}
              disabled={!all && picked.size === 0}
              onClick={async () => {
                setBusy(true);
                const r = await setMemberPropertyScope(membershipId, all ? [] : [...picked]);
                setBusy(false);
                if (!r.ok) return void toast.error(r.error);
                toast.success(`Property access updated for ${memberName}`);
                setOpen(false);
                router.refresh();
              }}
            >
              Save access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
