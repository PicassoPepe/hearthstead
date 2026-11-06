import * as React from "react";
import { cn } from "@/lib/utils";

/** Every list's empty state teaches the next action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  secondary?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-card border border-dashed border-border-strong bg-surface px-6 py-12 text-center", className)}>
      {icon ? (
        <div aria-hidden className="mb-4 flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground [&_svg]:size-5">
          {icon}
        </div>
      ) : null}
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action || secondary ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}{secondary}</div> : null}
    </div>
  );
}
