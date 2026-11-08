/** Shown instantly while a page streams in (Next.js loading.tsx). Mirrors the common page layout. */
export function PageSkeleton({ variant = "staff" }: { variant?: "staff" | "portal" }) {
  if (variant === "portal") {
    return (
      <div role="status" aria-label="Loading" className="grid gap-4">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-36 w-full rounded-card" />
        <div className="grid gap-3 sm:grid-cols-2"><div className="skeleton h-24 rounded-card" /><div className="skeleton h-24 rounded-card" /></div>
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  return (
    <div role="status" aria-label="Loading" className="grid gap-6">
      <div className="flex items-end justify-between gap-4">
        <div className="grid min-w-0 flex-1 gap-2"><div className="skeleton h-4 w-24" /><div className="skeleton h-8 w-64 max-w-full" /><div className="skeleton h-4 w-full max-w-sm" /></div>
        <div className="skeleton hidden h-9 w-32 sm:block" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton h-[104px] rounded-card" />)}</div>
      <div className="rounded-card border border-border bg-surface p-4 shadow-card">
        <div className="skeleton mb-4 h-9 w-72 max-w-full" />
        {Array.from({ length: 8 }, (_, i) => <div key={i} className="mb-2 flex gap-4"><div className="skeleton h-5 flex-[2]" /><div className="skeleton h-5 flex-1" /><div className="skeleton h-5 flex-1" /><div className="skeleton h-5 w-20" /></div>)}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
