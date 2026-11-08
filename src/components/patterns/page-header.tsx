import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  actions,
  className,
  eyebrow,
  icon,
}: {
  title: string;
  /** Optional lucide icon shown in a soft brand tile next to the title. */
  icon?: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <span aria-hidden className="mt-0.5 hidden size-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground sm:flex [&_svg]:size-5">{icon}</span> : null}
        <div className="min-w-0">
          {eyebrow ? <div className="mb-1 text-[13px] text-muted-foreground">{eyebrow}</div> : null}
          <h1 className="truncate font-display text-2xl font-bold tracking-tight">{title}</h1>
          {description ? <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
