"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, CreditCard, DollarSign, Gavel, LogOut, Play, Printer, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { MoneyForm, MONEY_TITLES, type MoneyKind, type MoneyOptions } from "./money-form";
import { activateLease, moveOut, setEviction } from "@/server/actions/leasing";

/** Lease header actions: Post charge, Receive payment, more (credit, deposit, refunds, move-out, eviction). */
export function LeaseActions({
  leaseId, status, balanceCents, options, canMoney, canEdit,
}: {
  leaseId: string; status: string; balanceCents: number; options: MoneyOptions; canMoney: boolean; canEdit: boolean;
}) {
  const router = useRouter();
  const [money, setMoney] = React.useState<MoneyKind | null>(null);
  const [moveOutOpen, setMoveOutOpen] = React.useState(false);
  const [evict, setEvict] = React.useState<"on" | "off" | null>(null);
  const [moveDate, setMoveDate] = React.useState(options.today);
  const [reason, setReason] = React.useState("");
  const [prorate, setProrate] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const live = status === "ACTIVE" || status === "EVICTION";

  if (status === "DRAFT") {
    return canEdit ? (
      <Button
        loading={busy}
        onClick={async () => {
          setBusy(true);
          const r = await activateLease(leaseId);
          setBusy(false);
          if (!r.ok) return void toast.error(r.error);
          toast.success("Lease activated — deposit and rent posted");
          router.refresh();
        }}
      >
        <Play aria-hidden /> Activate lease
      </Button>
    ) : null;
  }

  return (
    <>
      {canEdit && live ? <Button variant="secondary" onClick={() => setMoney("CHARGE")}><Receipt aria-hidden /> Post charge</Button> : null}
      {canMoney ? <Button onClick={() => setMoney("PAYMENT")}><DollarSign aria-hidden /> Receive payment</Button> : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary">More <ChevronDown aria-hidden /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit ? <DropdownMenuItem onSelect={() => setMoney("CREDIT")}><CreditCard aria-hidden /> Post credit</DropdownMenuItem> : null}
          {canMoney ? <DropdownMenuItem onSelect={() => setMoney("DEPOSIT")}><DollarSign aria-hidden /> Record deposit received</DropdownMenuItem> : null}
          {canMoney ? <DropdownMenuItem onSelect={() => setMoney("REFUND_DEPOSIT")}>Refund deposit</DropdownMenuItem> : null}
          {canMoney && balanceCents < 0 ? <DropdownMenuItem onSelect={() => setMoney("REFUND_PREPAID")}>Refund credit balance</DropdownMenuItem> : null}
          <DropdownMenuItem asChild><a href={`/app/leasing/${leaseId}/statement`} target="_blank" rel="noopener"><Printer aria-hidden /> Statement</a></DropdownMenuItem>
          {canEdit && live ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setMoveOutOpen(true)}><LogOut aria-hidden /> Move out / end lease</DropdownMenuItem>
              {status === "ACTIVE" ? <DropdownMenuItem destructive onSelect={() => setEvict("on")}><Gavel aria-hidden /> Set eviction</DropdownMenuItem> : null}
              {status === "EVICTION" ? <DropdownMenuItem onSelect={() => setEvict("off")}><Gavel aria-hidden /> Cancel eviction</DropdownMenuItem> : null}
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={money !== null} onOpenChange={(o) => !o && setMoney(null)}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{money ? MONEY_TITLES[money] : ""}</DialogTitle></DialogHeader>
          <DialogBody>{money ? <MoneyForm kind={money} leaseId={leaseId} balanceCents={balanceCents} options={options} onDone={() => setMoney(null)} /> : null}</DialogBody>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOutOpen} onOpenChange={setMoveOutOpen}>
        <DialogContent aria-describedby="mo-desc">
          <DialogHeader>
            <DialogTitle>Move out / end lease</DialogTitle>
            <DialogDescription id="mo-desc">Recurring charges stop on the move-out date. The lease ends that day.</DialogDescription>
          </DialogHeader>
          <form
            className="contents"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await moveOut(leaseId, { moveOutDate: moveDate, reason, prorate });
              setBusy(false);
              if (!r.ok) return void toast.error(r.error);
              toast.success("Move-out recorded");
              setMoveOutOpen(false);
              router.refresh();
            }}
          >
            <DialogBody className="grid gap-4">
              <Field label="Move-out date" required>{(a) => <Input {...a} type="date" value={moveDate} onChange={(e) => setMoveDate(e.target.value)} />}</Field>
              <Field label="Reason">{(a) => <Input {...a} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Bought a home" />}</Field>
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={prorate} onCheckedChange={setProrate} aria-label="Credit unused rent for the final month" />
                Credit unused days of the final month&apos;s rent (prorated)
              </label>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setMoveOutOpen(false)}>Cancel</Button>
              <Button type="submit" loading={busy}>Record move-out</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={evict !== null}
        onOpenChange={(o) => !o && setEvict(null)}
        title={evict === "on" ? "Start eviction?" : "Cancel eviction?"}
        description={evict === "on" ? "The lease is flagged as in eviction. Rent and late fees keep posting until move-out." : "The lease returns to active."}
        confirmLabel={evict === "on" ? "Set eviction" : "Cancel eviction"}
        destructive={evict === "on"}
        onConfirm={async () => {
          const r = await setEviction(leaseId, evict === "on");
          setEvict(null);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message ?? "Saved");
          router.refresh();
        }}
      />
    </>
  );
}
