import * as React from "react";

/** Title + status + key stats + actions. Used by every detail page (property, lease, person...). */
export function EntityHeader({
  title,
  subtitle,
  status,
  stats,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: React.ReactNode;
  status?: React.ReactNode;
  stats?: { label: string; value: React.ReactNode }[];
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <header className="mb-6 rounded-card border border-border bg-surface p-5 shadow-card">
      {breadcrumb ? <nav aria-label="Breadcrumb" className="mb-2 text-[13px] text-muted-foreground">{breadcrumb}</nav> : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            {status}
          </div>
          {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {stats && stats.length ? (
        <dl className="mt-4 grid grid-cols-2 gap-4 border-t border-border pt-4 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className="tabular mt-0.5 text-base font-semibold">{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}
