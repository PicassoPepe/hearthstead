"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { payApplicationFeeAction, saveApplicationStepAction, submitApplicationAction } from "@/server/actions/public";
import type { ApplicationData } from "@/server/funnel/applications";
import { cn } from "@/lib/utils";

const STEPS = ["About you", "Where you live now", "Work & income", "A few more questions", "Review & pay"];
type Section = keyof ApplicationData;

/** Applicant stepper with autosave (debounced) and per-step validation from the server. */
export function ApplyForm({ orgSlug, slug, initial, initialStep, fee, feePaid }: { orgSlug: string; slug: string; initial: ApplicationData; initialStep: number; fee: string | null; feePaid: boolean }) {
  const [data, setData] = React.useState<ApplicationData>(initial);
  const [step, setStep] = React.useState(Math.min(initialStep, 4));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saved, setSaved] = React.useState<"idle" | "pending" | "saving" | "saved">("idle");
  const [paid, setPaid] = React.useState(feePaid);
  const [card, setCard] = React.useState({ number: "", exp: "", cvc: "" });
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const heading = React.useRef<HTMLHeadingElement>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const persist = React.useCallback(async (d: ApplicationData, s: number) => {
    setSaved("saving");
    const r = await saveApplicationStepAction(orgSlug, s, d);
    setSaved(r.ok ? "saved" : "idle");
    return r;
  }, [orgSlug]);
  const set = (section: Section, key: string, value: string) => {
    const next = { ...data, [section]: { ...data[section], [key]: value } } as ApplicationData;
    setData(next);
    setSaved("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void persist(next, step), 800);
  };
  const go = async (to: number) => {
    if (timer.current) clearTimeout(timer.current);
    setBusy("next");
    const r = await persist(data, Math.max(step, to));
    setBusy("");
    if (!r.ok) return void toast.error(r.error);
    if (to > step && Object.keys(r.data).length) { setErrors(r.data); toast.error("Please fix the highlighted fields"); return; }
    setErrors({});
    setStep(to);
    requestAnimationFrame(() => heading.current?.focus());
  };
  // A render helper, not a component — defining a component inside render would remount inputs on every keystroke.
  const field = ({ s, k, label, type = "text", required, ...rest }: { s: Section; k: string; label: string; type?: string; required?: boolean; autoComplete?: string; inputMode?: "numeric" | "decimal" | "tel"; maxLength?: number; description?: string }) => (
    <Field label={label} required={required} error={errors[`${s}.${k}`]} description={rest.description}>{(a) => <Input {...a} type={type} autoComplete={rest.autoComplete} inputMode={rest.inputMode} maxLength={rest.maxLength} value={(data[s] as Record<string, string | undefined>)[k] ?? ""} onChange={(e) => set(s, k, e.target.value)} />}</Field>
  );

  return (
    <div className="grid gap-6">
      <ol aria-label="Application steps" className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((l, i) => (
          <li key={l} aria-current={i === step ? "step" : undefined} className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-1", i === step ? "border-primary bg-primary-soft font-medium text-primary-soft-foreground" : i < step ? "border-border text-foreground" : "border-border text-muted-foreground")}>
            {i < step ? <Check className="size-3" aria-hidden /> : <span aria-hidden>{i + 1}</span>}{l}
          </li>
        ))}
      </ol>
      <div className="rounded-card border border-border bg-surface p-5 shadow-card">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 ref={heading} tabIndex={-1} className="text-lg font-semibold outline-none">Step {step + 1} of {STEPS.length}: {STEPS[step]}</h2>
          <span role="status" className="text-xs text-muted-foreground">{saved === "pending" ? "Unsaved changes" : saved === "saving" ? "Saving…" : saved === "saved" ? "Saved" : ""}</span>
        </div>
        {step === 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field({ s: "about", k: "firstName", label: "First name", required: true, autoComplete: "given-name" })}
            {field({ s: "about", k: "lastName", label: "Last name", required: true, autoComplete: "family-name" })}
            {field({ s: "about", k: "phone", label: "Mobile phone", type: "tel", required: true, autoComplete: "tel" })}
            {field({ s: "about", k: "dob", label: "Date of birth", type: "date", required: true, autoComplete: "bday" })}
            {field({ s: "about", k: "ssnLast4", label: "SSN — last 4 digits", required: true, inputMode: "numeric", maxLength: 4, description: "Used only for the screening report." })}
            {field({ s: "about", k: "desiredMoveIn", label: "Desired move-in", type: "date" })}
          </div>
        ) : step === 1 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{field({ s: "residence", k: "currentAddress", label: "Current address", required: true, autoComplete: "street-address" })}</div>
            {field({ s: "residence", k: "monthsAtAddress", label: "Months at this address", required: true, inputMode: "numeric" })}
            {field({ s: "residence", k: "currentRent", label: "Current monthly rent", inputMode: "decimal" })}
            {field({ s: "residence", k: "landlordName", label: "Landlord or manager name" })}
            {field({ s: "residence", k: "landlordPhone", label: "Landlord phone", type: "tel" })}
            <div className="sm:col-span-2"><Field label="Reason for moving">{(a) => <Textarea {...a} rows={2} value={data.residence.reasonForMoving ?? ""} onChange={(e) => set("residence", "reasonForMoving", e.target.value)} />}</Field></div>
          </div>
        ) : step === 2 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field({ s: "employment", k: "employer", label: "Employer", required: true, autoComplete: "organization" })}
            {field({ s: "employment", k: "title", label: "Job title", autoComplete: "organization-title" })}
            {field({ s: "employment", k: "monthsEmployed", label: "Months employed", inputMode: "numeric" })}
            {field({ s: "employment", k: "monthlyIncome", label: "Monthly income before taxes", required: true, inputMode: "decimal" })}
            {field({ s: "employment", k: "otherIncome", label: "Other monthly income", inputMode: "decimal", description: "Child support, benefits, etc. — optional" })}
          </div>
        ) : step === 3 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {field({ s: "more", k: "occupants", label: "Number of occupants", inputMode: "numeric" })}
            {field({ s: "more", k: "pets", label: "Pets (type, weight)" })}
            {field({ s: "more", k: "vehicles", label: "Vehicles" })}
            {field({ s: "more", k: "reference", label: "Personal reference (name, phone)" })}
            <Field label="Have you ever been evicted?" required error={errors["more.evicted"]}>{(a) => <NativeSelect {...a} value={data.more.evicted ?? ""} onChange={(e) => set("more", "evicted", e.target.value)}><option value="">Choose…</option><option value="no">No</option><option value="yes">Yes</option></NativeSelect>}</Field>
            <div className="sm:col-span-2"><Field label="Anything else we should know?">{(a) => <Textarea {...a} rows={2} value={data.more.notes ?? ""} onChange={(e) => set("more", "notes", e.target.value)} />}</Field></div>
          </div>
        ) : (
          <div className="grid gap-4">
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {[["Name", `${data.about.firstName ?? ""} ${data.about.lastName ?? ""}`], ["Phone", data.about.phone], ["Current address", data.residence.currentAddress], ["Employer", data.employment.employer], ["Monthly income", data.employment.monthlyIncome ? `$${data.employment.monthlyIncome}` : ""], ["Pets", data.more.pets || "None"]].map(([k, v]) => <div key={k} className="flex justify-between gap-2 border-b border-border py-1"><dt className="text-muted-foreground">{k}</dt><dd>{v}</dd></div>)}
            </dl>
            {fee ? (
              paid ? <p className="rounded-lg bg-success-soft p-3 text-sm text-success-soft-foreground">✓ Application fee of {fee} paid.</p> : (
                <fieldset className="grid gap-3 rounded-lg border border-border p-3">
                  <legend className="px-1 text-sm font-medium">Application fee — {fee}</legend>
                  <Field label="Card number" error={errors.number}>{(a) => <Input {...a} inputMode="numeric" autoComplete="cc-number" value={card.number} onChange={(e) => setCard({ ...card, number: e.target.value })} placeholder="4242 4242 4242 4242" />}</Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Expiry (MM/YY)" error={errors.exp}>{(a) => <Input {...a} autoComplete="cc-exp" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} />}</Field>
                    <Field label="Security code">{(a) => <Input {...a} inputMode="numeric" autoComplete="cc-csc" value={card.cvc} onChange={(e) => setCard({ ...card, cvc: e.target.value })} />}</Field>
                  </div>
                  <Button type="button" variant="secondary" loading={busy === "pay"} onClick={async () => {
                    setBusy("pay");
                    const r = await payApplicationFeeAction(orgSlug, card);
                    setBusy("");
                    if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
                    setPaid(true);
                    toast.success(`Fee paid — ${fee}`);
                  }}>Pay {fee}</Button>
                </fieldset>
              )
            ) : null}
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-0.5 size-4" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>I certify my answers are true and authorize the landlord to obtain consumer reports (credit, eviction and criminal history) to evaluate this application.</span>
            </label>
            {errors.consent ? <p role="alert" className="text-sm text-danger">{errors.consent}</p> : null}
          </div>
        )}
      </div>
      <div className="flex justify-between gap-2">
        <Button variant="secondary" disabled={step === 0} onClick={() => go(step - 1)}>Back</Button>
        {step < 4 ? <Button loading={busy === "next"} onClick={() => go(step + 1)}>Next</Button> : (
          <Button loading={busy === "submit"} disabled={Boolean(fee) && !paid} onClick={async () => {
            setBusy("submit");
            const r = await submitApplicationAction(orgSlug, slug, consent);
            setBusy("");
            if (r && !r.ok) { setErrors(r.fieldErrors ?? {}); toast.error(r.error); }
          }}>Submit application</Button>
        )}
      </div>
    </div>
  );
}
