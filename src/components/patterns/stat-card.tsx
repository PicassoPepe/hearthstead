import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  hint,
  trend,
  href,
  className,
  icon,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: { direction: "up" | "down"; text: string; good?: boolean };
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-medium text-muted-foreground">{label}</div>
        {icon ? <span aria-hidden className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground [&_svg]:size-4">{icon}</span> : null}
      </div>
      <div className="tabular mt-1 font-display text-[26px] font-bold tracking-tight">{value}</div>
      <div className="mt-0.5 flex min-h-0 items-center gap-2 text-xs text-muted-foreground empty:hidden sm:mt-1">
        {trend ? (
          <span className={cn("inline-flex items-center gap-0.5 font-medium", trend.good ? "text-success" : "text-danger")}>
            {trend.direction === "up" ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}
            {trend.text}
          </span>
        ) : null}
        {hint}
      </div>
    </>
  );
  const cls = cn("block rounded-card border border-border bg-surface p-3 shadow-card sm:p-4", href && "card-hover", className);
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
