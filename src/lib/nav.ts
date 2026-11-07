import type { Module } from "@/server/permissions";

/**
 * Two-level navigation. Clicking a top-level section with children swaps the sidebar to its
 * submenu (with a "← Section" header). `phase` marks features that land in later phases.
 */
export type NavLeaf = { label: string; href: string; phase?: number; keywords?: string[] };
export type NavSection = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  module?: Module;
  children?: NavLeaf[];
  phase?: number;
};

export type IconName =
  | "overview" | "rentals" | "leasing" | "people" | "accounting" | "tasks" | "communications"
  | "reports" | "notes" | "files" | "workflows" | "ai" | "settings" | "help";

export const NAV_MAIN: NavSection[] = [
  { id: "overview", label: "Overview", href: "/app/overview", icon: "overview" },
  {
    id: "rentals", label: "Rentals", href: "/app/rentals", icon: "rentals", module: "rentals", phase: 2,
    children: [
      { label: "Properties", href: "/app/rentals", phase: 2 },
      { label: "Units", href: "/app/rentals/units", phase: 2 },
      { label: "Listings", href: "/app/rentals/listings", phase: 9 },
      { label: "Portfolios", href: "/app/rentals/portfolios", phase: 2 },
    ],
  },
  {
    id: "leasing", label: "Leasing", href: "/app/leasing", icon: "leasing", module: "leasing", phase: 3,
    children: [
      { label: "Leases", href: "/app/leasing", phase: 3 },
      { label: "Renewals", href: "/app/leasing/renewals", phase: 9 },
      { label: "Applications", href: "/app/leasing/applications", phase: 9 },
      { label: "Showings", href: "/app/leasing/showings", phase: 9 },
    ],
  },
  {
    id: "people", label: "People", href: "/app/people", icon: "people", module: "people", phase: 2,
    children: [
      { label: "Tenants", href: "/app/people/tenants", phase: 3 },
      { label: "Owners", href: "/app/people/owners", phase: 2 },
      { label: "Vendors", href: "/app/people/vendors", phase: 5 },
      { label: "Prospects", href: "/app/people/prospects", phase: 9 },
      { label: "Users", href: "/app/settings/users" },
    ],
  },
  {
    id: "accounting", label: "Accounting", href: "/app/accounting", icon: "accounting", module: "accounting", phase: 3,
    children: [
      { label: "Chart of accounts", href: "/app/accounting", phase: 3, keywords: ["coa", "gl"] },
      { label: "Banking", href: "/app/accounting/banking", phase: 6 },
      { label: "Reconcile", href: "/app/accounting/reconcile", phase: 6 },
      { label: "Bills", href: "/app/accounting/bills", phase: 6, keywords: ["payables", "ap"] },
      { label: "Expenses", href: "/app/accounting/expenses", phase: 6 },
      { label: "Vendor credits", href: "/app/accounting/vendor-credits", phase: 6 },
      { label: "Journal entries", href: "/app/accounting/journal-entries", phase: 3 },
      { label: "Incoming payments", href: "/app/accounting/payments", phase: 4 },
      { label: "Owner distributions", href: "/app/accounting/distributions", phase: 6 },
      { label: "Management fees", href: "/app/accounting/management-fees", phase: 6 },
    ],
  },
  { id: "tasks", label: "Tasks", href: "/app/tasks", icon: "tasks", module: "tasks", phase: 5 },
  { id: "communications", label: "Communications", href: "/app/communications", icon: "communications", module: "communications", phase: 8 },
  { id: "reports", label: "Reports", href: "/app/reports", icon: "reports", module: "reports", phase: 7 },
  { id: "notes", label: "Notes", href: "/app/notes", icon: "notes", phase: 2 },
  { id: "files", label: "Files", href: "/app/files", icon: "files", module: "files", phase: 2 },
  { id: "workflows", label: "Workflows", href: "/app/workflows", icon: "workflows", module: "workflows", phase: 10 },
  { id: "ai", label: "AI Assistant", href: "/app/ai", icon: "ai", module: "ai", phase: 10 },
];

export const SETTINGS_NAV: NavLeaf[] = [
  { label: "Company & branding", href: "/app/settings" },
  { label: "Users & roles", href: "/app/settings/users", keywords: ["team", "permissions", "invite"] },
  { label: "Payments", href: "/app/settings/payments", keywords: ["stripe", "fees"] },
  { label: "Fees & late fees", href: "/app/settings/late-fees", keywords: ["grace"] },
  { label: "Management fees", href: "/app/settings/management-fees", phase: 6 },
  { label: "Maintenance", href: "/app/settings/maintenance", keywords: ["auto-assign", "requests", "work orders"] },
  { label: "Notifications", href: "/app/settings/notifications", keywords: ["reminders"] },
  { label: "Tenant portal", href: "/app/settings/tenant-portal" },
  { label: "Owner portal", href: "/app/settings/owner-portal" },
  { label: "Rental applications", href: "/app/settings/applications" },
  { label: "Listings", href: "/app/settings/listings", phase: 9 },
  { label: "Integrations", href: "/app/settings/integrations", keywords: ["api", "webhooks", "quickbooks"] },
  { label: "Security", href: "/app/settings/security", keywords: ["2fa", "sessions", "support access"] },
  { label: "Billing", href: "/app/settings/billing" },
];

export const NAV_BOTTOM: NavSection[] = [
  { id: "settings", label: "Settings", href: "/app/settings", icon: "settings", children: SETTINGS_NAV },
  { id: "help", label: "Help", href: "/app/help", icon: "help" },
];

export const CURRENT_PHASE = 5;

/** Find the section that owns a pathname (longest-prefix match across sections and children). */
export function sectionForPath(pathname: string): NavSection | undefined {
  const under = (h: string) => pathname === h || pathname.startsWith(h + "/");
  let best: { s: NavSection; score: number } | undefined;
  for (const s of [...NAV_MAIN, ...NAV_BOTTOM]) {
    const hrefs = [s.href, ...(s.children?.map((c) => c.href) ?? [])];
    for (const h of hrefs) {
      if (!under(h)) continue;
      // Longest match wins; on ties prefer the section whose own URL contains the path
      // (e.g. /app/settings/users belongs to Settings even though People links to it).
      const score = h.length + (under(s.href) ? 0.5 : 0);
      if (!best || score > best.score) best = { s, score };
    }
  }
  return best?.s;
}

/** Create-new menu (grouped). `kind` maps to /app/new/[kind] (rendered as an intercepted modal). */
export type CreateKind =
  | "property" | "unit" | "lease" | "application" | "prospect" | "charge" | "payment" | "bill"
  | "expense" | "journal-entry" | "transfer" | "task" | "work-order" | "tenant" | "owner" | "vendor" | "user";

export const CREATE_MENU: { group: string; items: { kind: CreateKind; label: string; phase: number; module: Module }[] }[] = [
  { group: "Rentals", items: [
    { kind: "property", label: "Property", phase: 2, module: "rentals" },
    { kind: "unit", label: "Unit", phase: 2, module: "rentals" },
  ] },
  { group: "Leasing", items: [
    { kind: "lease", label: "Lease", phase: 3, module: "leasing" },
    { kind: "application", label: "Rental application", phase: 9, module: "leasing" },
    { kind: "prospect", label: "Prospect", phase: 9, module: "leasing" },
  ] },
  { group: "Money", items: [
    { kind: "charge", label: "Charge", phase: 3, module: "accounting" },
    { kind: "payment", label: "Payment", phase: 3, module: "accounting" },
    { kind: "bill", label: "Bill", phase: 6, module: "accounting" },
    { kind: "expense", label: "Expense", phase: 6, module: "accounting" },
    { kind: "journal-entry", label: "Journal entry", phase: 3, module: "accounting" },
    { kind: "transfer", label: "Transfer", phase: 6, module: "accounting" },
  ] },
  { group: "Work", items: [
    { kind: "task", label: "Task", phase: 5, module: "tasks" },
    { kind: "work-order", label: "Work order", phase: 5, module: "tasks" },
  ] },
  { group: "People", items: [
    { kind: "tenant", label: "Tenant", phase: 3, module: "people" },
    { kind: "owner", label: "Owner", phase: 2, module: "people" },
    { kind: "vendor", label: "Vendor", phase: 5, module: "people" },
    { kind: "user", label: "User", phase: 1, module: "users" },
  ] },
];

export function createItem(kind: string) {
  for (const g of CREATE_MENU) for (const i of g.items) if (i.kind === kind) return i;
  return undefined;
}
