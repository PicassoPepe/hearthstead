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
        <div aria-hidden className="relative mb-5 flex size-16 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-primary-soft opacity-60" />
          <span className="absolute inset-2 rounded-full border-2 border-dashed border-primary/30" />
          <span className="relative flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md [&_svg]:size-5">{icon}</span>
        </div>
      ) : null}
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      {action || secondary ? <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{action}{secondary}</div> : null}
    </div>
  );
}
