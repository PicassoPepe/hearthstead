# Assumptions & defaults

Decisions made without asking, per the brief. Each can be changed later.

**Product**
- App name **Hearthstead**, brand color **#0F766E** (teal 700; 5.47:1 on white). Dark mode uses
  teal 400 (#2DD4BF) with dark text. The `{{EXTRA_CONTEXT}}` placeholder was empty.
- Demo data is fictional; emails use the reserved `example.com` domain.
- Currency is USD only; amounts are integer cents everywhere (`src/lib/money.ts`).

**Stack versions (pinned for stability)**
- Next.js **15.5** (not 16) — Auth.js v5 beta and the intercepting/parallel-route patterns are
  best-proven there. React 19.2, Tailwind 4, Prisma **6.19** (Prisma 7/8 change client
  generation and require driver adapters), TanStack Table **8** (v9 is a rewrite), Zod 4.
- Single Next.js app rather than a Turborepo monorepo (optional per brief); `src/server` and
  `src/adapters` are kept framework-agnostic so they can move into packages later.
- shadcn/ui components are written in-repo on Radix primitives (the shadcn CLI needs network
  access to its registry); APIs match shadcn's.
- Font: system UI stack with Inter first if installed — no build-time font download.

**Auth & tenancy**
- Auth.js v5 with JWT sessions; credentials (bcrypt) + magic link (custom email provider routed
  through our `EmailProvider`). Magic links only sign in *existing* users (invited or signed up).
- The Auth.js `Account` model is named `AuthAccount` because `Account` is reserved for the
  chart of accounts (Phase 3); a small proxy maps the adapter onto it.
- Users are global identities; `Membership` links a user to an org with a role. Invites are
  accepted automatically on first sign-in with that email.
- Built-in roles are copied into each org at creation, so orgs can edit them (except Admin).
- Active org is a cookie (`hs_org`) validated against memberships on every request; falls back
  to `User.lastOrgId`, then the oldest membership.
- Soft delete (`deletedAt`) is filtered automatically on reads by the DAL; pass `deletedAt`
  explicitly in `where` to include deleted rows.

**UI**
- Saved table views are stored per-browser (localStorage) in Phase 1; they move to the database
  alongside per-user dashboard layouts in Phase 7.
- Sections from later phases are navigable and show a "arrives in Phase N" empty state rather
  than 404, so navigation and permissions can be exercised now.
- Next.js dev indicator is disabled so it doesn't cover the sidebar.

**Phase 2 (Rentals)**
- The chart of accounts and bank-account records are created in Phase 2 (not 3) so properties
  can reference their default operating/deposit accounts. Every new org gets the default chart;
  `prisma/backfill.ts` adds it to existing orgs. The ledger that posts to them is Phase 3.
- Ownership is stored in basis points (10000 = 100%); bathrooms in tenths (15 = 1.5) — no floats.
- If a property has owners, their shares must total exactly 100%. Owners are optional.
- Only the last 4 digits of an owner's tax ID are stored.
- "Archive" is a soft delete with undo; nothing in Rentals is hard-deleted from the UI.
- The stored-file model is named `Attachment` (a model named `File` would clash with the DOM
  `File` type in TypeScript). Uploads: 10 MB max, allow-listed types, served only through an
  authenticated, tenant-scoped route with `nosniff` and a sandbox CSP.
- Address autocomplete uses a mock `AddressProvider` (completes a typed street against a city
  list) — swap in Google Places/Mapbox/Smarty by implementing `suggest()`.
- The importer handles properties+units and owners in Phase 2; tenants, leases and opening
  balances are added in Phase 3 when those tables exist. Rows with an existing property name add
  units to that property. All rows must validate before anything is written (single transaction).
- Occupancy and balances show "—" until leases and the ledger exist (Phase 3).
- Members limited to specific properties can't create properties or run property imports.

**Phase 3 (Leasing & ledger)**
- A lease is ACTIVE from creation (unless saved as a draft). Leases with a future start date
  hold the unit from that date; the overlap rule uses move-out date, else a fixed term's end
  date, else open-ended (month-to-month).
- Fixed-term leases keep billing after their end date (holdover / month-to-month) until a
  move-out is recorded — that's how most landlords operate; Expiring/Renewals flags them.
- Payments go to *Undeposited Funds* by default (bank deposits/reconciliation are Phase 6).
- Payment application order is a setting (oldest-first default, or rent-first).
- Security deposits can be billed (Dr A/R, Cr Deposits Held) or recorded as received. Deposits
  are held separately and never change the tenant's rent balance.
- Late fees are per rent period (the month a rent charge is due); the monthly max caps the
  initial fee plus any daily fees for that period.
- Voids post reversing entries dated today; nothing is ever deleted from the journal.
- Imported leases don't back-bill rent: the opening balance (owed today; negative = credit)
  posts against *Opening Balance Equity*, and rent starts on the 1st of next month.
- Statements are a printable page (browser "Save as PDF"); emailing statements comes with the
  communications center (Phase 8). Portal invites mark tenants as invited; emails start in Phase 4.
- Charges/credits require Leasing → edit; payments, deposits, refunds and voids require
  Accounting → edit.

**Phase 4 (Payments & tenant portal)**
- Online payments post to the ledger as soon as money is in flight (card: succeeded; ACH:
  processing), so the tenant's balance updates immediately. A later ACH failure is posted as a
  returned payment (no NSF fee by default) — the same path as a bounced check.
- The convenience fee (pass-through, per setting) is collected by the processor and never posted
  to the tenant's ledger; rent income is never reduced by processing costs.
- Processor pricing for pass-through: card 2.9% + 30¢, ACH 0.8% capped at $5.
- One processor account per organization (Stripe Connect Express); payouts go to the account's
  bank. Per-property payout routing can be added with separate connected accounts later.
- Tenant logins are ordinary Users linked to Tenant records (TenantUser), so the same Auth.js
  sign-in works; a login with no staff membership is routed to the portal. Portal queries are
  always filtered to the signed-in tenant's leases, on top of org-level RLS.
- Staff "Preview portal as" is read-only (every portal write is refused) and audit-logged.
- Autopay runs in the nightly job on/after the chosen day, at most once per month, for the
  full balance (or a fixed amount); nothing is charged when nothing is due.
- Maintenance requests (Phase 5) and messages/announcements (Phase 8) appear in the portal as
  placeholders until those phases.

**Phase 5 (Maintenance)**
- One Task model covers tasks, tenant/owner requests, work orders and inspections (`type`), with
  per-org numbers (#1001…), subtasks, assignees and an activity timeline. Assigning a vendor to a
  plain task turns it into a work order. A parent can't be completed while subtasks are open.
- Activity entries are *internal* by default; on tenant requests, status changes and replies
  marked "Visible to the tenant" appear on the portal timeline (and email the tenant if the
  `maintenance.notifyTenantOnUpdate` setting is on).
- Auto-assign rules map a category to a team member and/or vendor (company level).
- Vendor logins (Vendor role + `Vendor.userId`) see every task assigned to their vendor and may
  comment and change status, but never create or archive tasks, and their comments are internal.
- Inspections use a default room-by-room template; the report is a printable page. The AI
  summary goes through `LlmProvider` (deterministic mock by default) and is audit-logged.
- Bills are created from work orders (vendor invoice → bill posts Dr expense / Cr A/P).

**Phase 6 (Accounting)**
- Trust-style accounting: every cash line carries a property dimension, so per-property cash,
  payables and owner balances come straight from the journal. A/P is credited per property; a
  partial bill payment is split across the bill's properties in proportion to its lines.
- Payments land in Undeposited Funds; a bank deposit moves selected payments (grouped by property)
  to a bank account. Processor payouts (mock: two days after success) deposit automatically. A
  payment returned after it was deposited comes out of the bank it was deposited to.
- Bank feed: the mock mirrors the books at the *journal-entry* level (one bank line per entry, so a
  six-property bill payment is one debit) with a 0–2 day lag, plus a monthly $15 service fee and
  interest. Matching = same signed amount within ±5 days; it auto-matches only when exactly one
  candidate exists and no other feed line competes for it. CSV import dedupes on date/amount/row.
- Reconciliation ticks register items (journal entries on that bank); opening balance = everything
  cleared in completed reconciliations. Finishing requires a $0.00 difference; only the latest
  reconciliation can be undone.
- Available to distribute = operating bank + Undeposited Funds − Prepaid Rent − open payables −
  reserve (never negative). Security-deposit bank accounts are excluded.
- Management fees: one company default rule plus optional per-property overrides; percent of
  collected rent (payments applied to RENT charges in the month) or of all collected income, with
  a minimum, or a flat amount. Each run creates a bill from "<company> — management" and pays it
  from the property's default operating account. The nightly job runs last month (idempotent per
  property + month); it can also be run manually for any month.
- Recurring bills are created by the nightly job (idempotent per bill + month); a bill can be set
  to repeat when it's created.
- Voids always post reversing entries; a bill with payments or applied credits can't be voided
  until those are voided/unapplied.

**Not yet done (by design)**
- 2FA, session management and support-access toggle (Settings → Security) — Phase 10.
- Per-member property scoping is stored and enforced by `canAccessProperty()` but has no UI
  until properties exist (Phase 2).
- BullMQ is installed with Redis in compose; the first jobs (recurring charges, late fees) come in Phase 3.
