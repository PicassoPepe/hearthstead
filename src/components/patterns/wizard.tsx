"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WizardStep = {
  id: string;
  title: string;
  /** Return an error message to block "Next", or null when the step is valid. */
  validate?: () => string | null | Promise<string | null>;
  content: React.ReactNode;
  optional?: boolean;
  /** Show "Skip for now" and advance without running validate. */
  skippable?: boolean;
  onSkip?: () => void;
};

/**
 * Multi-step wizard: stepper, Back/Next/Finish, per-step validation, optional save-as-draft.
 * Steps after the current one can't be jumped to until every earlier step validates.
 */
export function Wizard({
  steps,
  onFinish,
  finishLabel = "Finish",
  onSaveDraft,
  onCancel,
  initialStep = 0,
  onStepChange,
}: {
  steps: WizardStep[];
  onFinish: () => Promise<void> | void;
  finishLabel?: string;
  onSaveDraft?: () => void;
  onCancel?: () => void;
  initialStep?: number;
  onStepChange?: (index: number) => void;
}) {
  const [index, setIndex] = React.useState(Math.min(initialStep, steps.length - 1));
  const [maxReached, setMaxReached] = React.useState(index);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);
  const step = steps[index]!;
  const last = index === steps.length - 1;

  const go = (i: number) => {
    setError(null);
    setIndex(i);
    setMaxReached((m) => Math.max(m, i));
    onStepChange?.(i);
    // Move focus to the new step's heading for screen-reader and keyboard users.
    requestAnimationFrame(() => headingRef.current?.focus());
  };

  const next = async () => {
    setBusy(true);
    try {
      const msg = (await step.validate?.()) ?? null;
      if (msg) return setError(msg);
      if (last) await onFinish();
      else go(index + 1);
    } finally {
      setBusy(false);
    }
  };

  const skip = () => {
    step.onSkip?.();
    if (!last) go(index + 1);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav aria-label="Progress" className="border-b border-border px-5 py-3">
        <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[13px]">
          {steps.map((s, i) => {
            const done = i < index;
            const current = i === index;
            const reachable = i <= maxReached;
            return (
              <li key={s.id} className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!reachable || busy}
                  onClick={() => reachable && go(i)}
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-2 py-1 font-medium",
                    current ? "bg-primary-soft text-primary-soft-foreground" : done ? "text-foreground hover:bg-surface-muted" : "text-muted-foreground",
                    !reachable && "cursor-not-allowed",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-5 items-center justify-center rounded-full text-[11px]",
                      done ? "bg-primary text-primary-foreground" : current ? "border-2 border-primary" : "border border-border-strong",
                    )}
                  >
                    {done ? <Check className="size-3" /> : i + 1}
                  </span>
                  <span className={cn(!current && "hidden sm:inline")}>{s.title}</span>
                  <span className="sr-only">{done ? " (completed)" : current ? " (current step)" : ""}</span>
                </button>
                {i < steps.length - 1 ? <span aria-hidden className="h-px w-3 bg-border-strong" /> : null}
              </li>
            );
          })}
        </ol>
      </nav>

      <section aria-labelledby="wizard-step-title" className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <h2 id="wizard-step-title" ref={headingRef} tabIndex={-1} className="mb-4 text-base font-semibold focus:outline-none">
          Step {index + 1} of {steps.length}: {step.title}
          {step.optional ? <span className="ml-2 text-xs font-normal text-muted-foreground">Optional</span> : null}
        </h2>
        {step.content}
        {error ? (
          <p role="alert" className="mt-4 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">
            {error}
          </p>
        ) : null}
      </section>

      <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
        {onSaveDraft ? (
          <Button type="button" variant="ghost" onClick={onSaveDraft} disabled={busy}>
            Save as draft
          </Button>
        ) : null}
        <div className="ml-auto flex gap-2">
          {index > 0 ? (
            <Button type="button" variant="secondary" onClick={() => go(index - 1)} disabled={busy}>
              Back
            </Button>
          ) : null}
          {step.skippable && !last ? (
            <Button type="button" variant="ghost" onClick={skip} disabled={busy}>
              Skip for now
            </Button>
          ) : null}
          <Button type="button" onClick={next} loading={busy}>
            {last ? finishLabel : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}
