"use client";

import * as React from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, NativeSelect } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { US_STATES, type PropertyEditInput } from "@/lib/rentals";
import { editProperty } from "@/server/actions/rentals";

type Opts = { portfolios: { id: string; name: string }[]; bankAccounts: { id: string; label: string; purpose: string }[] };

/** "Edit details" drawer. Opens automatically with ?edit=1 (used by the table's row menu). */
export function PropertyEditButton({ id, initial, options }: { id: string; initial: PropertyEditInput; options: Opts }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [open, setOpen] = React.useState(sp.get("edit") === "1");
  const [v, setV] = React.useState(initial);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const setAddr = (k: keyof PropertyEditInput["address"], val: string) => setV((p) => ({ ...p, address: { ...p.address, [k]: val } }));
  const close = () => {
    setOpen(false);
    if (sp.get("edit")) router.replace(pathname + "?tab=overview", { scroll: false });
  };

  return (
    <>
      <Button variant="secondary" onClick={() => { setV(initial); setErrors({}); setOpen(true); }}>
        <Pencil aria-hidden /> Edit
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent side="right" aria-describedby="edit-prop-desc">
          <DialogHeader>
            <DialogTitle>Edit property</DialogTitle>
            <DialogDescription id="edit-prop-desc">Name, address, portfolio and default bank accounts.</DialogDescription>
          </DialogHeader>
          <form
            id="property-edit"
            noValidate
            className="contents"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const r = await editProperty(id, v);
              setBusy(false);
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return void toast.error(r.error);
              }
              toast.success("Property saved");
              close();
              router.refresh();
            }}
          >
            <DialogBody className="grid gap-4 sm:grid-cols-6">
              <Field label="Property name" error={errors.name} required className="sm:col-span-6">
                {(a) => <Input {...a} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />}
              </Field>
              <Field label="Street address" error={errors["address.addressLine1"]} required className="sm:col-span-4">
                {(a) => <Input {...a} value={v.address.addressLine1} onChange={(e) => setAddr("addressLine1", e.target.value)} />}
              </Field>
              <Field label="Apt / suite" className="sm:col-span-2">
                {(a) => <Input {...a} value={v.address.addressLine2 ?? ""} onChange={(e) => setAddr("addressLine2", e.target.value)} />}
              </Field>
              <Field label="City" error={errors["address.city"]} required className="sm:col-span-3">
                {(a) => <Input {...a} value={v.address.city} onChange={(e) => setAddr("city", e.target.value)} />}
              </Field>
              <Field label="State" error={errors["address.state"]} required className="sm:col-span-1">
                {(a) => (
                  <NativeSelect {...a} value={v.address.state} onChange={(e) => setAddr("state", e.target.value)}>
                    {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="ZIP" error={errors["address.postalCode"]} required className="sm:col-span-2">
                {(a) => <Input {...a} value={v.address.postalCode} onChange={(e) => setAddr("postalCode", e.target.value)} />}
              </Field>
              <Field label="Portfolio" className="sm:col-span-3">
                {(a) => (
                  <NativeSelect {...a} value={v.portfolioId ?? ""} onChange={(e) => setV({ ...v, portfolioId: e.target.value || null })}>
                    <option value="">No portfolio</option>
                    {options.portfolios.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Year built" error={errors.yearBuilt} className="sm:col-span-3">
                {(a) => (
                  <Input {...a} inputMode="numeric" value={v.yearBuilt?.toString() ?? ""} onChange={(e) => setV({ ...v, yearBuilt: e.target.value ? Number(e.target.value) : null })} />
                )}
              </Field>
              <Field label="Operating account" className="sm:col-span-3">
                {(a) => (
                  <NativeSelect {...a} value={v.defaultOperatingAccountId ?? ""} onChange={(e) => setV({ ...v, defaultOperatingAccountId: e.target.value || null })}>
                    <option value="">Not set</option>
                    {options.bankAccounts.filter((b) => b.purpose !== "SECURITY_DEPOSIT").map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Deposit account" className="sm:col-span-3">
                {(a) => (
                  <NativeSelect {...a} value={v.defaultDepositAccountId ?? ""} onChange={(e) => setV({ ...v, defaultDepositAccountId: e.target.value || null })}>
                    <option value="">Not set</option>
                    {options.bankAccounts.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </NativeSelect>
                )}
              </Field>
              <Field label="Reserve" description="Held back from owner distributions." className="sm:col-span-3">
                {(a) => <MoneyInput {...a} valueCents={v.reserveCents ?? 0} onChangeCents={(c) => setV({ ...v, reserveCents: c ?? 0 })} />}
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
              <Button type="submit" loading={busy}>Save changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
