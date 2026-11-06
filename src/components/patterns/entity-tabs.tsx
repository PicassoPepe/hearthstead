import Link from "next/link";
import { cn } from "@/lib/utils";

/** URL-driven tabs (?tab=) so every tab is linkable, server-rendered and back-button friendly. */
export function EntityTabs({ base, tabs, active }: { base: string; tabs: { id: string; label: string; count?: number }[]; active: string }) {
  return (
    <nav aria-label="Sections" className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <Link
            key={t.id}
            href={`${base}?tab=${t.id}`}
            scroll={false}
            aria-current={on ? "page" : undefined}
            className={cn(
              "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
              on ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count != null ? <span className="rounded-full bg-surface-muted px-1.5 text-xs tabular text-muted-foreground">{t.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
