import * as React from "react";

export type TimelineItem = { id: string; title: React.ReactNode; meta?: React.ReactNode; at: Date; icon?: React.ReactNode };

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function Timeline({ items, empty = "No activity yet." }: { items: TimelineItem[]; empty?: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {items.map((i) => (
        <li key={i.id} className="relative">
          <span aria-hidden className="absolute -left-[26px] top-1 flex size-3 items-center justify-center rounded-full border-2 border-surface bg-primary" />
          <div className="text-sm">{i.title}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            <time dateTime={i.at.toISOString()}>{fmt.format(i.at)}</time>
            {i.meta ? <> · {i.meta}</> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
