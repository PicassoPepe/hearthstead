/**
 * Calendar-date helpers. Ledger dates are plain calendar days stored as UTC midnight
 * (Postgres `date`), so all math here is done in UTC to avoid DST/timezone drift.
 */
export type ISODate = string; // "2026-11-06"

export function toISODate(d: Date): ISODate {
  return d.toISOString().slice(0, 10);
}

export function parseISODate(s: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new RangeError(`Invalid date "${s}"`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || toISODate(d) !== s) throw new RangeError(`Invalid date "${s}"`);
  return d;
}

export function utcDate(y: number, m0: number, day: number): Date {
  return new Date(Date.UTC(y, m0, day));
}

export function daysInMonth(d: Date): number {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

export function startOfMonth(d: Date): Date {
  return utcDate(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function endOfMonth(d: Date): Date {
  return utcDate(d.getUTCFullYear(), d.getUTCMonth(), daysInMonth(d));
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86_400_000);
}

/** Add months, clamping the day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(d: Date, n: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + n;
  const first = utcDate(y, m, 1);
  return utcDate(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d.getUTCDate(), daysInMonth(first)));
}

/** Whole days from a to b (b − a). */
export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** "2026-11" */
export function periodOf(d: Date): string {
  return toISODate(d).slice(0, 7);
}

export function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}
export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

/** Today's calendar date in an IANA timezone, as a UTC-midnight Date. */
export function todayIn(timeZone: string, now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parseISODate(parts);
}

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return fmt.format(typeof d === "string" ? parseISODate(d.slice(0, 10)) : d);
}
