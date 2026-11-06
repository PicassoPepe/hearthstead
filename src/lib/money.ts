/**
 * Money helpers. All amounts are integer cents. Floats never cross this boundary:
 * parsing works on the decimal *string* so 0.1 + 0.2 style errors cannot occur.
 */
export type Cents = number;

export function assertCents(value: number): asserts value is Cents {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Money must be an integer number of cents, got ${value}`);
  }
}

/** Parse user input like "1,234.5", "$12", "-3.07", "(45.00)" into cents. Returns null if invalid. */
export function parseMoney(input: string): Cents | null {
  let s = input.trim().replace(/[$,\s]/g, "");
  if (s === "") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  const m = /^(\d*)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m || (m[1] === "" && (m[2] ?? "") === "")) return null;
  const whole = m[1] === "" ? 0 : Number(m[1]);
  const frac = Number(((m[2] ?? "") + "00").slice(0, 2));
  const cents = whole * 100 + frac;
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

const formatters = new Map<string, Intl.NumberFormat>();
function fmt(currency: string, showCents: boolean): Intl.NumberFormat {
  const key = `${currency}:${showCents}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: showCents ? 2 : 0,
      maximumFractionDigits: showCents ? 2 : 0,
    });
    formatters.set(key, f);
  }
  return f;
}

/** Format cents for display. Uses integer math for the major/minor split. */
export function formatMoney(
  cents: Cents,
  opts: { currency?: string; showCents?: boolean } = {},
): string {
  assertCents(cents);
  const { currency = "USD", showCents = true } = opts;
  // Intl receives a number with at most 2 decimals derived from integers — exact for display.
  const major = Math.trunc(cents / 100);
  const minor = Math.abs(cents % 100);
  const sign = cents < 0 ? "-" : "";
  const value = Number(`${sign}${Math.abs(major)}.${minor.toString().padStart(2, "0")}`);
  return fmt(currency, showCents).format(value);
}

/** Format cents as a plain editable string: 123456 -> "1234.56". */
export function centsToInput(cents: Cents): string {
  assertCents(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${(abs % 100).toString().padStart(2, "0")}`;
}

/** Sum a list of cents safely. */
export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  assertCents(total);
  return total;
}

/**
 * Split `total` cents into parts proportional to `weights` using the largest-remainder
 * method, so the parts always sum exactly to `total`.
 */
export function allocateCents(total: Cents, weights: readonly number[]): Cents[] {
  assertCents(total);
  if (weights.length === 0) return [];
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (wSum <= 0) throw new RangeError("Allocation weights must sum to a positive number");
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / wSum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = abs - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    remainder--;
  }
  return floors.map((f) => f * sign);
}
