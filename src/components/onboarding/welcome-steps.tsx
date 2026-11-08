"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Circle, X } from "lucide-react";

export type WelcomeStep = { id: string; label: string; description: string; href: string; done: boolean };

/**
 * First-visit welcome for portal users (tenants, owners, vendors): a short, dismissible list of
 * the things worth doing first. Disappears when everything's done; dismissal is remembered on this device.
 */
export function WelcomeSteps({ storageKey, title, intro, steps }: { storageKey: string; title: string; intro: string; steps: WelcomeStep[] }) {
  const [hidden, setHidden] = React.useState(false);
  React.useEffect(() => {
    try { if (localStorage.getItem(storageKey) === "1") setHidden(true); } catch { /* storage unavailable */ }
  }, [storageKey]);
  const done = steps.filter((s) => s.done).length;
  if (hidden || done === steps.length) return null;
  return (
    <section aria-labelledby={`${storageKey}-h`} className="relative rounded-card border border-primary/30 bg-gradient-to-br from-primary-soft/70 to-surface p-5 shadow-card">
      <button type="button" aria-label="Dismiss welcome" className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground hover:bg-surface-muted"
        onClick={() => { setHidden(true); try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ } }}>
        <X className="size-4" aria-hidden />
      </button>
      <h2 id={`${storageKey}-h`} className="pr-8 text-lg font-semibold">{title}</h2>
      <p className="mt-0.5 text-sm text-muted-foreground">{intro} <span className="font-medium text-foreground">{done} of {steps.length} done.</span></p>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.id}>
            <Link href={s.href} className="flex h-full items-start gap-3 rounded-lg border border-border bg-surface p-3 transition-colors hover:border-border-strong">
              {s.done ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden /> : <Circle className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />}
              <span>
                <span className={s.done ? "font-medium text-muted-foreground line-through" : "font-medium"}>{s.label}</span>
                <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                <span className="block text-xs text-muted-foreground">{s.description}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
