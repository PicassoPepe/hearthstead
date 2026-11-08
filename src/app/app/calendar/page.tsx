import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { requireContext } from "@/server/context";
import { can } from "@/server/permissions";
import { adminDb } from "@/server/db";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { CALENDAR_KINDS, CALENDAR_LABEL, calendarEvents, type CalendarEvent, type CalendarKind } from "@/server/calendar/events";
import { addDays, addMonths, endOfMonth, startOfMonth, toISODate, todayIn, utcDate } from "@/lib/dates";
import { cn } from "@/lib/utils";

export const metadata = { title: "Calendar" };

/** Dot/chip colors per kind — always paired with a text label, never color alone. */
const TONE: Record<CalendarKind, string> = {
  SHOWING: "bg-info-soft text-info-soft-foreground",
  MOVE_IN: "bg-success-soft text-success-soft-foreground",
  MOVE_OUT: "bg-warning-soft text-warning-soft-foreground",
  LEASE_END: "bg-warning-soft text-warning-soft-foreground",
  INSPECTION: "bg-primary-soft text-primary-soft-foreground",
  TASK: "bg-surface-muted text-foreground",
  RENEWAL: "bg-danger-soft text-danger-soft-foreground",
};
const SHORT: Record<CalendarKind, string> = { SHOWING: "Showing", MOVE_IN: "Move-in", MOVE_OUT: "Move-out", LEASE_END: "Lease end", INSPECTION: "Inspection", TASK: "Task", RENEWAL: "Renewal" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; show?: string }> }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: ctx.org.id }, select: { timezone: true } });
  const today = todayIn(org.timezone);
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? utcDate(Number(sp.month!.slice(0, 4)), Number(sp.month!.slice(5, 7)) - 1, 1) : startOfMonth(today);
  const shown = new Set<CalendarKind>(sp.show ? (sp.show.split(",").filter((k) => (CALENDAR_KINDS as readonly string[]).includes(k)) as CalendarKind[]) : CALENDAR_KINDS);
  // Grid: Sunday-start weeks covering the month.
  const gridStart = addDays(month, -month.getUTCDay());
  const last = endOfMonth(month);
  const gridEnd = addDays(last, 6 - last.getUTCDay());
  const events = (await calendarEvents(ctx, gridStart, gridEnd, org.timezone)).filter((e) => shown.has(e.kind));
  const byDay = new Map<string, CalendarEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const ym = (d: Date) => toISODate(d).slice(0, 7);
  const q = (patch: { month?: string; show?: string | null }) => {
    const p = new URLSearchParams({ month: patch.month ?? ym(month) });
    const show = patch.show === undefined ? sp.show : patch.show;
    if (show) p.set("show", show);
    return `/app/calendar?${p}`;
  };
  const toggle = (k: CalendarKind) => {
    const next = new Set(shown);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next.size === CALENDAR_KINDS.length ? null : [...next].join(",") || k;
  };
  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const todayIso = toISODate(today);
  const canTask = can(ctx.permissions, "tasks", "edit");
  const upcoming = events.filter((e) => e.date >= toISODate(month) && e.date <= toISODate(last));

  return (
    <>
      <PageHeader icon={<CalendarDays aria-hidden />} title="Calendar" description="Showings, move-ins and move-outs, lease ends, inspections, tasks and renewal deadlines in one place."
        actions={canTask ? <Button asChild><Link href="/app/new/task" scroll={false}><Plus aria-hidden /> New task</Link></Button> : undefined} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button asChild variant="secondary" size="icon" aria-label="Previous month"><Link href={q({ month: ym(addMonths(month, -1)) })}><ChevronLeft aria-hidden /></Link></Button>
          <Button asChild variant="secondary" size="icon" aria-label="Next month"><Link href={q({ month: ym(addMonths(month, 1)) })}><ChevronRight aria-hidden /></Link></Button>
          <Button asChild variant="ghost" size="sm"><Link href={q({ month: ym(today) })}>Today</Link></Button>
        </div>
        <h2 className="text-lg font-semibold" aria-live="polite">{monthLabel}</h2>
        <ul className="ml-auto flex flex-wrap gap-1.5" aria-label="Show event types">
          {CALENDAR_KINDS.map((k) => (
            <li key={k}>
              <Link href={q({ show: toggle(k) })} aria-pressed={shown.has(k)} role="button"
                className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", shown.has(k) ? cn(TONE[k], "border-transparent") : "border-border text-muted-foreground line-through")}>
                {CALENDAR_LABEL[k]}
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Month grid (tablet and up) */}
      <div className="hidden overflow-hidden rounded-card border border-border bg-surface shadow-card md:block">
        <div className="grid grid-cols-7 border-b border-border bg-surface-muted/60 text-xs font-medium text-muted-foreground" aria-hidden>
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
        </div>
        <ol className="grid grid-cols-7">
          {days.map((d) => {
            const iso = toISODate(d);
            const list = byDay.get(iso) ?? [];
            const out = d.getUTCMonth() !== month.getUTCMonth();
            return (
              <li key={iso} className={cn("group min-h-28 min-w-0 overflow-hidden border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0", out && "bg-surface-muted/40")}>
                <div className="mb-1 flex items-center justify-between">
                  <span className={cn("flex size-6 items-center justify-center rounded-full text-xs", iso === todayIso ? "bg-primary font-bold text-primary-foreground" : out ? "text-muted-foreground" : "font-medium")}>
                    <span className="sr-only">{d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })}{iso === todayIso ? " (today)" : ""}</span>
                    <span aria-hidden>{d.getUTCDate()}</span>
                  </span>
                  {canTask ? <Link href={`/app/new/task?dueDate=${iso}`} scroll={false} className="rounded p-0.5 text-muted-foreground opacity-0 hover:bg-surface-muted focus:opacity-100 group-hover:opacity-100" aria-label={`New task due ${iso}`}><Plus className="size-3.5" aria-hidden /></Link> : null}
                </div>
                <ul className="grid min-w-0 grid-cols-1 gap-0.5">
                  {list.slice(0, 3).map((e) => (
                    <li key={e.id}>
                      <Link href={e.href} className={cn("block truncate rounded px-1.5 py-0.5 text-[11px] font-medium hover:brightness-95", TONE[e.kind])} title={`${e.title}${e.detail ? ` — ${e.detail}` : ""}`}>
                        {e.time ? `${e.time} ` : ""}{e.title}
                      </Link>
                    </li>
                  ))}
                  {list.length > 3 ? <li className="px-1.5 text-[11px] text-muted-foreground">+{list.length - 3} more</li> : null}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Agenda (all sizes; the only view on phones) */}
      <section aria-labelledby="agenda-h" className="mt-6">
        <h2 id="agenda-h" className="mb-2 text-[15px] font-semibold">Agenda · {monthLabel}</h2>
        {upcoming.length === 0 ? (
          <p className="rounded-card border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Nothing scheduled this month.</p>
        ) : (
          <ol className="grid gap-3" data-testid="agenda">
            {[...new Set(upcoming.map((e) => e.date))].map((day) => (
              <li key={day} className="rounded-card border border-border bg-surface shadow-card">
                <h3 className={cn("border-b border-border px-4 py-2 text-sm font-semibold", day === todayIso && "text-primary")}>
                  {new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}{day === todayIso ? " · Today" : ""}
                </h3>
                <ul className="divide-y divide-border">
                  {upcoming.filter((e) => e.date === day).map((e) => (
                    <li key={e.id}>
                      <Link href={e.href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-muted/50">
                        <span className={cn("w-20 shrink-0 rounded px-1.5 py-0.5 text-center text-[11px] font-semibold", TONE[e.kind])}>{SHORT[e.kind]}</span>
                        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{e.title}</span>{e.detail ? <span className="block truncate text-xs text-muted-foreground">{e.detail}</span> : null}</span>
                        {e.time ? <span className="shrink-0 text-xs tabular text-muted-foreground">{e.time}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
