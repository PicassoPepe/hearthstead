"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { addHouseholdMemberAction, removeHouseholdMemberAction } from "@/server/actions/public";

type Member = { id: string; role: string; name: string; email: string; status: string };
const ROLE: Record<string, string> = { CO_APPLICANT: "Co-applicant", GUARANTOR: "Guarantor" };

/** Primary applicant: invite other adults who'll live there (co-applicants) and guarantors. */
export function HouseholdPanel({ orgSlug, slug, members }: { orgSlug: string; slug: string; members: Member[] }) {
  const router = useRouter();
  const [v, setV] = React.useState({ firstName: "", lastName: "", email: "", role: "CO_APPLICANT" as "CO_APPLICANT" | "GUARANTOR" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  return (
    <section aria-labelledby="hh-h" className="mt-6 rounded-card border border-border bg-surface p-5 shadow-card">
      <h2 id="hh-h" className="flex items-center gap-2 text-lg font-semibold"><UserPlus className="size-5" aria-hidden /> Anyone applying with you?</h2>
      <p className="mt-1 text-sm text-muted-foreground">Add every adult who'll live in the home (co-applicants) and anyone guaranteeing the lease. Each person gets an email link to fill in their own part — your details stay private.</p>
      {members.length ? (
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border" data-testid="household-members">
          {members.map((m) => (
            <li key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1"><span className="font-medium">{m.name}</span> <span className="text-muted-foreground">· {ROLE[m.role] ?? m.role} · {m.email}</span></span>
              <span className={m.status === "DRAFT" ? "text-muted-foreground" : "font-medium text-success"}>{m.status === "DRAFT" ? "Invited" : "Submitted ✓"}</span>
              {m.status === "DRAFT" ? (
                <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.name}`} onClick={async () => {
                  const r = await removeHouseholdMemberAction(orgSlug, m.id);
                  if (!r.ok) return void toast.error(r.error);
                  router.refresh();
                }}><X aria-hidden /></Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <form noValidate className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await addHouseholdMemberAction(orgSlug, slug, v);
        setBusy(false);
        if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
        toast.success(r.message);
        setErrors({});
        setV({ firstName: "", lastName: "", email: "", role: v.role });
        router.refresh();
      }}>
        <Field label="Their first name" error={errors.firstName}>{(a) => <Input {...a} value={v.firstName} onChange={(e) => setV({ ...v, firstName: e.target.value })} />}</Field>
        <Field label="Their last name">{(a) => <Input {...a} value={v.lastName} onChange={(e) => setV({ ...v, lastName: e.target.value })} />}</Field>
        <Field label="Their email" error={errors.email}>{(a) => <Input {...a} type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />}</Field>
        <Field label="They are a…">{(a) => <NativeSelect {...a} value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as "CO_APPLICANT" | "GUARANTOR" })}><option value="CO_APPLICANT">Co-applicant (will live there)</option><option value="GUARANTOR">Guarantor (co-signs, won't live there)</option></NativeSelect>}</Field>
        <div className="sm:col-span-2"><Button type="submit" variant="secondary" loading={busy}>Send invitation</Button></div>
      </form>
    </section>
  );
}
