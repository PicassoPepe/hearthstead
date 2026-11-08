import * as React from "react";
import { cn, initials } from "@/lib/utils";

export function Separator({ className }: { className?: string }) {
  return <div role="separator" className={cn("h-px w-full bg-border", className)} />;
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden className={cn("skeleton", className)} {...props} />;
}

export function Avatar({ name, className, src }: { name: string | null | undefined; className?: string; src?: string | null }) {
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt="" className={cn("inline-block size-8 shrink-0 rounded-full object-cover", className)} />;
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary-soft-foreground", className)}>
      {initials(name)}
    </span>
  );
}

export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("rounded border border-border-strong bg-surface-muted px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground", className)}>{children}</kbd>;
}

export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
