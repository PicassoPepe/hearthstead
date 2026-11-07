/** Dashboard widget catalog, role presets and the data shape the widgets render. */

export const WIDGET_IDS = ["rent", "aging", "occupancy", "pnl", "expiring", "requests", "bills", "cash"] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export const WIDGET_META: Record<WidgetId, { title: string; description: string; href: string; module: string }> = {
  rent: { title: "Rent collected vs due", description: "This month's rent charges and what's been paid against them.", href: "/app/reports/delinquency", module: "leasing" },
  aging: { title: "Outstanding balances", description: "Open charges aged by days past due.", href: "/app/reports/delinquency", module: "leasing" },
  occupancy: { title: "Occupancy", description: "Occupied, vacant and on-notice units.", href: "/app/reports/vacancy", module: "rentals" },
  pnl: { title: "Income vs expenses", description: "Last 6 months, accrual basis.", href: "/app/reports/profit-loss?groupBy=month", module: "accounting" },
  expiring: { title: "Leases expiring", description: "Ending in the next 30 / 60 / 90 days.", href: "/app/reports/lease-expirations", module: "leasing" },
  requests: { title: "Open requests", description: "Tasks and work orders by status.", href: "/app/tasks", module: "tasks" },
  bills: { title: "Bills due", description: "Overdue and due in the next 7 days.", href: "/app/accounting/bills", module: "accounting" },
  cash: { title: "Cash", description: "Ledger balance of each bank account.", href: "/app/accounting/banking", module: "accounting" },
};

export type DashboardLayout = { order: WidgetId[]; hidden: WidgetId[] };

export const PRESETS: Record<string, { label: string; layout: DashboardLayout }> = {
  default: { label: "Everything", layout: { order: [...WIDGET_IDS], hidden: [] } },
  PROPERTY_MANAGER: { label: "Property manager", layout: { order: ["rent", "occupancy", "expiring", "requests", "aging", "pnl", "bills", "cash"], hidden: ["cash", "bills"] } },
  BOOKKEEPER: { label: "Bookkeeper", layout: { order: ["cash", "bills", "pnl", "aging", "rent", "occupancy", "expiring", "requests"], hidden: ["requests", "expiring"] } },
  MAINTENANCE: { label: "Maintenance", layout: { order: ["requests", "occupancy", "expiring", "rent", "aging", "pnl", "bills", "cash"], hidden: ["rent", "aging", "pnl", "bills", "cash"] } },
};

/** Accept only known ids; append any new widgets so they show up after an upgrade. */
export function sanitizeLayout(raw: unknown, fallback: DashboardLayout = PRESETS.default!.layout): DashboardLayout {
  const r = (raw ?? {}) as Partial<Record<keyof DashboardLayout, unknown>>;
  const valid = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is WidgetId => (WIDGET_IDS as readonly string[]).includes(x as string)) : null);
  const order = valid(r.order) ?? fallback.order;
  const seen = [...new Set(order)];
  for (const id of WIDGET_IDS) if (!seen.includes(id)) seen.push(id);
  return { order: seen, hidden: [...new Set(valid(r.hidden) ?? fallback.hidden)] };
}

export type WidgetData = {
  today: string;
  rent: { dueCents: number; collectedCents: number };
  aging: { current: number; d30: number; d60: number; d90: number; tenantsOwing: number };
  occupancy: { units: number; occupied: number; vacant: number; notice: number };
  expiring: { d30: number; d60: number; d90: number; next: { id: string; label: string; endDate: string }[] };
  requests: Record<string, number>;
  pnl: { month: string; income: number; expenses: number }[];
  bills: { overdueCents: number; weekCents: number; next: { id: string; vendor: string; dueDate: string; openCents: number }[] };
  cash: { id: string; name: string; cents: number }[];
};

/** Strip data for widgets the member can't see, so it never reaches the browser. */
export function redactWidgetData(d: WidgetData, allowed: WidgetId[]): WidgetData {
  const ok = (id: WidgetId) => allowed.includes(id);
  return {
    today: d.today,
    rent: ok("rent") ? d.rent : { dueCents: 0, collectedCents: 0 },
    aging: ok("aging") ? d.aging : { current: 0, d30: 0, d60: 0, d90: 0, tenantsOwing: 0 },
    occupancy: ok("occupancy") ? d.occupancy : { units: 0, occupied: 0, vacant: 0, notice: 0 },
    expiring: ok("expiring") ? d.expiring : { d30: 0, d60: 0, d90: 0, next: [] },
    requests: ok("requests") ? d.requests : {},
    pnl: ok("pnl") ? d.pnl : [],
    bills: ok("bills") ? d.bills : { overdueCents: 0, weekCents: 0, next: [] },
    cash: ok("cash") ? d.cash : [],
  };
}
