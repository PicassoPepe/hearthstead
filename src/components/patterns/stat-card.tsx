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
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: { direction: "up" | "down"; text: string; good?: boolean };
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
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
  const cls = cn("block rounded-card border border-border bg-surface p-4 shadow-card", href && "transition-colors hover:border-border-strong", className);
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
