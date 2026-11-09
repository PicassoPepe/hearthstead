"use client";

import * as React from "react";
import { toast } from "sonner";
import { sendSiteMessageAction } from "@/server/actions/website";

const input = "h-11 w-full rounded-[var(--site-radius)] border border-[var(--site-border)] bg-[var(--site-surface)] px-3 text-base text-[var(--site-text)] placeholder:text-[var(--site-muted)] focus:outline-2 focus:outline-[var(--site-primary)]";

/** Contact or tour-request form. Messages land in the company's "People interested" list. */
export function SiteMessageForm({ orgSlug, kind, preview }: { orgSlug: string; kind: "contact" | "tour"; preview?: boolean }) {
  const [v, setV] = React.useState({ name: "", email: "", phone: "", message: "", when: "", website: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const id = React.useId();
  if (sent) return <p role="status" className="rounded-[var(--site-radius)] bg-[var(--site-soft)] p-4 font-medium">Thanks! We got your {kind === "tour" ? "tour request" : "message"} and will get back to you soon.</p>;
  const field = (k: keyof typeof v, label: string, el: React.ReactElement<React.InputHTMLAttributes<HTMLInputElement>>) => (
    <div className="grid gap-1">
      <label htmlFor={`${id}-${k}`} className="text-sm font-medium">{label}</label>
      {React.cloneElement(el, { id: `${id}-${k}`, "aria-invalid": errors[k] ? true : undefined, "aria-describedby": errors[k] ? `${id}-${k}-e` : undefined } as React.InputHTMLAttributes<HTMLInputElement>)}
      {errors[k] ? <p id={`${id}-${k}-e`} className="text-sm text-[#b91c1c]">{errors[k]}</p> : null}
    </div>
  );
  return (
    <form noValidate className="grid gap-3" onSubmit={async (e) => {
      e.preventDefault();
      if (preview) return void toast.info("This is a preview — forms work once the site is published.");
      setBusy(true);
      const r = await sendSiteMessageAction(orgSlug, { kind, ...v });
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      setSent(true);
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        {field("name", "Your name", <input className={input} autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />)}
        {field("phone", "Phone (optional)", <input className={input} type="tel" autoComplete="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />)}
      </div>
      {field("email", "Email", <input className={input} type="email" autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />)}
      {kind === "tour" ? field("when", "When works for you?", <input className={input} placeholder="e.g. weekday evenings, Saturday morning" value={v.when} onChange={(e) => setV({ ...v, when: e.target.value })} />) : null}
      <div className="grid gap-1">
        <label htmlFor={`${id}-message`} className="text-sm font-medium">{kind === "tour" ? "Anything we should know?" : "Your message"}</label>
        <textarea id={`${id}-message`} rows={4} className={`${input} h-auto py-2`} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} aria-invalid={errors.message ? true : undefined} />
        {errors.message ? <p className="text-sm text-[#b91c1c]">{errors.message}</p> : null}
      </div>
      {/* Honeypot for spam bots — hidden from people and screen readers. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} /></label></div>
      <div><button type="submit" disabled={busy} className="rounded-[var(--site-radius)] bg-[var(--site-primary)] px-5 py-3 font-semibold text-[var(--site-on-primary)] hover:opacity-90 disabled:opacity-60">{busy ? "Sending…" : kind === "tour" ? "Request a tour" : "Send message"}</button></div>
    </form>
  );
}
