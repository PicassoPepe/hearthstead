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
  /** Shown only to vendor logins. */
  vendorOnly?: boolean;
};

export type IconName =
  | "overview" | "rentals" | "leasing" | "people" | "accounting" | "tasks" | "communications"
  | "reports" | "notes" | "files" | "workflows" | "ai" | "settings" | "help" | "calendar" | "invoices" | "more";

export const NAV_MAIN: NavSection[] = [
  { id: "overview", label: "Home", href: "/app/overview", icon: "overview" },
  {
    id: "rentals", label: "Properties", href: "/app/rentals", icon: "rentals", module: "rentals", phase: 2,
    children: [
      { label: "All properties", href: "/app/rentals", phase: 2, keywords: ["buildings", "houses", "rentals"] },
      { label: "Units (apartments & homes)", href: "/app/rentals/units", phase: 2, keywords: ["units", "apartments"] },
      { label: "Owners", href: "/app/people/owners", phase: 2, keywords: ["landlords", "investors"] },
      { label: "Keys & parking", href: "/app/rentals/keys", keywords: ["parking", "storage", "fob", "mailbox", "keys & spaces"] },
      { label: "For-rent ads", href: "/app/rentals/listings", phase: 9, keywords: ["listings", "vacancy", "advertise"] },
      { label: "Property groups", href: "/app/rentals/portfolios", phase: 2, keywords: ["portfolios"] },
    ],
  },
  {
    id: "leasing", label: "Tenants", href: "/app/people/tenants", icon: "leasing", module: "leasing", phase: 3,
    children: [
      { label: "All tenants", href: "/app/people/tenants", phase: 3, keywords: ["renters", "residents"] },
      { label: "Leases", href: "/app/leasing", phase: 3, keywords: ["contracts", "rent"] },
      { label: "Rental applications", href: "/app/leasing/applications", phase: 9, keywords: ["applicants", "screening"] },
      { label: "Showings", href: "/app/leasing/showings", phase: 9, keywords: ["tours", "visits"] },
      { label: "People interested", href: "/app/people/prospects", phase: 9, keywords: ["prospects", "leads"] },
      { label: "Lease renewals", href: "/app/leasing/renewals", phase: 9 },
      { label: "Raise the rent", href: "/app/leasing/rent-increase", keywords: ["rent increases", "bulk"] },
    ],
  },
  {
    id: "tasks", label: "Repairs", href: "/app/tasks", icon: "tasks", module: "tasks", phase: 5,
    children: [
      { label: "Repairs & to-dos", href: "/app/tasks", phase: 5, keywords: ["maintenance", "requests", "work orders", "tasks", "fix"] },
      { label: "Repair companies (vendors)", href: "/app/people/vendors", phase: 5, keywords: ["vendors", "contractors", "plumber"] },
    ],
  },
  { id: "invoices", label: "Invoices", href: "/app/invoices", icon: "invoices", module: "tasks", vendorOnly: true },
  {
    id: "accounting", label: "Rent & Money", href: "/app/money", icon: "accounting", module: "accounting", phase: 3,
    children: [
      { label: "Money home", href: "/app/money", keywords: ["who owes", "rent due"] },
      { label: "Rent paid online", href: "/app/accounting/payments", phase: 4, keywords: ["incoming payments"] },
      { label: "Discounts & concessions", href: "/app/money/discounts", keywords: ["discount", "concession", "promo code", "waive", "move-in special", "coupon"] },
      { label: "Bills to pay", href: "/app/accounting/bills", phase: 6, keywords: ["payables", "ap", "invoices"] },
      { label: "Expenses", href: "/app/accounting/expenses", phase: 6 },
      { label: "Pay owners", href: "/app/accounting/distributions", phase: 6, keywords: ["owner distributions", "payouts"] },
      { label: "Bank accounts", href: "/app/accounting/banking", phase: 6, keywords: ["banking"] },
      { label: "Match bank statement", href: "/app/accounting/reconcile", phase: 6, keywords: ["reconcile", "reconciliation"] },
      { label: "Budgets", href: "/app/accounting/budgets", keywords: ["budget vs actual", "forecast"] },
      { label: "Split utility bills", href: "/app/accounting/billback", keywords: ["rubs", "utilities", "water", "billback"] },
      { label: "Management fees", href: "/app/accounting/management-fees", phase: 6 },
      { label: "Vendor credits", href: "/app/accounting/vendor-credits", phase: 6 },
      { label: "Journal entries (advanced)", href: "/app/accounting/journal-entries", phase: 3 },
      { label: "Account list (advanced)", href: "/app/accounting", phase: 3, keywords: ["chart of accounts", "coa", "gl"] },
      { label: "Close the year", href: "/app/accounting/close", keywords: ["year-end close", "1099", "lock", "retained earnings"] },
    ],
  },
  {
    id: "communications", label: "Messages", href: "/app/communications", icon: "communications", module: "communications", phase: 8,
    children: [
      { label: "Inbox", href: "/app/communications", phase: 8, keywords: ["messages", "sms", "texts"] },
      { label: "Send to many (announcements)", href: "/app/communications/announcements", phase: 8, keywords: ["broadcast", "notice", "announcements"] },
    ],
  },
  { id: "calendar", label: "Calendar", href: "/app/calendar", icon: "calendar" },
  { id: "reports", label: "Reports", href: "/app/reports", icon: "reports", module: "reports", phase: 7 },
  {
    id: "more", label: "More", href: "/app/more", icon: "more",
    children: [
      { label: "More tools", href: "/app/more" },
      { label: "Your website", href: "/app/website", keywords: ["website", "site builder", "homepage", "vacancies", "web page"] },
      { label: "Files & documents", href: "/app/files", phase: 2, keywords: ["files", "import", "templates", "signatures"] },
      { label: "Notes", href: "/app/notes", phase: 2 },
      { label: "AI helper", href: "/app/ai", phase: 10, keywords: ["ai assistant", "agents"] },
      { label: "Automations", href: "/app/workflows", phase: 10, keywords: ["workflows"] },
    ],
  },
];

export const SETTINGS_NAV: NavLeaf[] = [
  { label: "Company & branding", href: "/app/settings" },
  { label: "Users & roles", href: "/app/settings/users", keywords: ["team", "permissions", "invite"] },
  { label: "Payments", href: "/app/settings/payments", keywords: ["stripe", "fees"] },
  { label: "Fees & late fees", href: "/app/settings/late-fees", keywords: ["grace"] },
  { label: "Management fees", href: "/app/settings/management-fees", phase: 6 },
  { label: "Maintenance", href: "/app/settings/maintenance", keywords: ["auto-assign", "requests", "work orders"] },
  { label: "Notifications", href: "/app/settings/notifications", keywords: ["reminders"] },
  { label: "Communications & SMS", href: "/app/settings/communications", keywords: ["sms", "text", "twilio"] },
  { label: "Tenant portal", href: "/app/settings/tenant-portal" },
  { label: "Owner portal", href: "/app/settings/owner-portal" },
  { label: "Rental applications", href: "/app/settings/applications" },
  { label: "Document templates", href: "/app/settings/templates", keywords: ["lease", "merge fields", "e-sign", "notice"] },
  { label: "Integrations", href: "/app/settings/integrations", keywords: ["api", "webhooks", "quickbooks"] },
  { label: "Security", href: "/app/settings/security", keywords: ["2fa", "sessions", "support access"] },
  { label: "Billing", href: "/app/settings/billing" },
  { label: "Backups", href: "/app/settings/backups", keywords: ["backup", "restore", "export", "download"] },
];

export const NAV_BOTTOM: NavSection[] = [
  { id: "settings", label: "Settings", href: "/app/settings", icon: "settings", children: SETTINGS_NAV },
  { id: "help", label: "Help", href: "/app/help", icon: "help" },
];

export const CURRENT_PHASE = 10;

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
  | "expense" | "journal-entry" | "transfer" | "task" | "work-order" | "repair" | "tenant" | "owner" | "vendor" | "user";

export const CREATE_MENU: { group: string; items: { kind: CreateKind; label: string; phase: number; module: Module }[] }[] = [
  { group: "Properties", items: [
    { kind: "property", label: "Property", phase: 2, module: "rentals" },
    { kind: "unit", label: "Unit", phase: 2, module: "rentals" },
  ] },
  { group: "Tenants", items: [
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
  { group: "Repairs", items: [
    { kind: "repair", label: "Repair", phase: 5, module: "tasks" },
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

/** Heading for a create form ("Report a repair", otherwise "New <thing>"). */
export const createTitle = (item: { kind: CreateKind; label: string }) => (item.kind === "repair" ? "Report a repair" : `New ${item.label.toLowerCase()}`);
