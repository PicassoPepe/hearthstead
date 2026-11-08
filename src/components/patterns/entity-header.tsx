import * as React from "react";

/** Title + status + key stats + actions. Used by every detail page (property, lease, person...). */
export function EntityHeader({
  title,
  subtitle,
  status,
  stats,
  actions,
  breadcrumb,
  image,
}: {
  title: string;
  subtitle?: React.ReactNode;
  status?: React.ReactNode;
  stats?: { label: string; value: React.ReactNode }[];
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
  /** Optional cover photo URL shown as a thumbnail beside the title. */
  image?: string | null;
}) {
  return (
    <header className="mb-6 rounded-card border border-border bg-surface p-5 shadow-card">
      {breadcrumb ? <nav aria-label="Breadcrumb" className="mb-2 text-[13px] text-muted-foreground">{breadcrumb}</nav> : null}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="" className="hidden size-16 shrink-0 rounded-lg border border-border object-cover sm:block" />
          ) : null}
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            {status}
          </div>
          {subtitle ? <div className="mt-1 text-sm text-muted-foreground">{subtitle}</div> : null}
          </div>
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
