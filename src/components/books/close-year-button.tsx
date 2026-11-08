"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { closeYearAction, reopenYearAction } from "@/server/actions/books";

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function CloseYearButton({ year, closed, netIncomeCents }: { year: number; closed: boolean; netIncomeCents: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <Button variant={closed ? "secondary" : "primary"} onClick={() => setOpen(true)}>{closed ? `Reopen ${year}` : `Close ${year}`}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="close-desc">
          <DialogHeader>
            <DialogTitle>{closed ? `Reopen ${year}?` : `Close ${year}?`}</DialogTitle>
            <DialogDescription id="close-desc">
              {closed ? `This reverses the closing entry and unlocks ${year} so you can post adjustments. Close it again when you're done.` : `Net income of ${money(netIncomeCents)} moves into Retained Earnings (by property) with a closing entry dated Dec 31, ${year}, and nothing dated in ${year} or earlier can be posted or voided afterwards.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody><p className="text-sm text-muted-foreground">Make sure bank accounts are reconciled through December and 1099s are reviewed first.</p></DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={closed ? "danger" : "primary"} loading={busy} onClick={async () => {
              setBusy(true);
              const r = closed ? await reopenYearAction(year) : await closeYearAction(year);
              setBusy(false);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              setOpen(false);
              router.refresh();
            }}>{closed ? `Reopen ${year}` : `Close ${year}`}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
