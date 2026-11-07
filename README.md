# Hearthstead

Multi-tenant property management for landlords and property managers: rentals, leasing, a
double-entry ledger, tenant and owner portals, maintenance, accounting and reporting.

> **Status: Phase 7 (Reports & dashboard) complete.** See [Roadmap](#roadmap) for what each phase adds.

## Quick start

### 1. Install the prerequisites (once)

| Tool | Version | Get it |
| --- | --- | --- |
| Node.js | 22 or newer | https://nodejs.org |
| pnpm | 10 | `npm install -g pnpm` |
| Docker Desktop | any recent | https://www.docker.com/products/docker-desktop — **start it before running the app** |

No Docker? A local PostgreSQL 16 on port 5432 (user `postgres`, password `postgres`) works too.

### 2. Get the code and run it

These commands work the same in **Windows PowerShell**, macOS and Linux. Run them one at a time:

```bash
git clone https://github.com/PicassoPepe/hearthstead.git
```
```bash
cd hearthstead
```
```bash
pnpm install
```
```bash
pnpm dev
```

`pnpm dev` creates `.env`, starts the database containers, migrates, applies row-level security,
seeds demo data on the first run, and starts the app. When it prints `Ready`, open
**http://localhost:3000**.

> **Windows PowerShell 5:** don't chain commands with `&&` (it isn't supported) — run each
> command on its own line as shown above.

### 3. Sign in

Every demo user's password is `Demo1234!x`:

| Role | Email |
| --- | --- |
| Admin (also a member of a 2nd org) | `admin@example.com` |
| Property Manager | `pm@example.com` |
| Bookkeeper | `books@example.com` |
| Maintenance | `maint@example.com` |
| Vendor (Ace Plumbing — sees only its jobs) | `vendor@example.com` |
| Read-only Owner | `owner@example.com` |
| Admin of "Harbor Light Rentals" | `harbor@example.com` |
| **Tenant (resident portal)** | `tenant@example.com` → http://localhost:3000/portal/tenant |

Magic-link emails are captured by the mock email provider — open **http://localhost:3000/dev/outbox**.

### Troubleshooting

| Problem | Fix |
| --- | --- |
| `Postgres is not reachable on localhost:5432` | Start Docker Desktop and wait until it says it's running, then `pnpm dev` again. |
| `port is already allocated` (5432 / 6379) | Another Postgres/Redis is running. Stop it, or stop the other container. |
| `The token '&&' is not a valid statement separator` | Windows PowerShell 5 — run each command on its own line. |
| Page says you have no organization | Reset the demo data: `pnpm db:seed`. |
| Want a clean slate | `pnpm db:reset` (drops everything, migrates, reseeds). |

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | One-command dev environment (cross-platform, `scripts/dev.mjs`) |
| `pnpm test` | Vitest: unit + integration (integration needs Postgres) |
| `pnpm test:e2e` | Playwright end-to-end, incl. axe accessibility checks (reseeds first) |
| `pnpm lint` / `pnpm typecheck` / `pnpm format` | ESLint, `tsc --noEmit`, Prettier |
| `pnpm db:migrate` | `prisma migrate deploy` + apply row-level security |
| `pnpm db:seed` / `pnpm db:reset` | Reseed demo data / drop everything and reseed |
| `pnpm worker` | BullMQ worker: runs the nightly rent + late-fee job at 02:15 (needs Redis) |
| `pnpm jobs:nightly [YYYY-MM-DD]` | Run the nightly job once, without Redis (idempotent) |
| `pnpm ledger:check` | Verify ledger invariants for every org |

## Environment variables

| Variable | Default (dev) | Purpose |
| --- | --- | --- |
| `DATABASE_ADMIN_URL` | `postgres://postgres:postgres@localhost:5432/hearthstead` | Table owner. Migrations, seed, auth lookups, system jobs. Bypasses RLS. |
| `DATABASE_URL` | `postgres://hearthstead_app:hearthstead_app@…` | Request-time role. **Not** the owner, so RLS applies. Created by `prisma/rls.sql`. |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ (background jobs, from Phase 3) |
| `AUTH_SECRET` | dev value | Auth.js JWT secret — **change in production** |
| `AUTH_URL` | `http://localhost:3000` | Public base URL (links in emails) |
| `EMAIL_PROVIDER` | `mock` | `mock` (records to DB, view at `/dev/outbox`) or `smtp` |
| `SMTP_URL` | `smtp://localhost:1025` | Mailpit in docker-compose; any SMTP relay in prod |
| `EMAIL_FROM` | `Hearthstead <no-reply@…>` | Sender |
| `STORAGE_PROVIDER` | `local` | `local` writes to `./storage`; `s3` uses the vars below |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` | — | MinIO: `http://localhost:9000`, `minio` / `minio12345` |
| `PAYMENTS_PROVIDER` | `mock` | `mock` (offline, Stripe-test-mode behavior) or `stripe` |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | — | Only for `PAYMENTS_PROVIDER=stripe` |

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    A[Staff app /app] --- P[Portals /portal/*]
    P --- X[Public /apply, /l]
  end
  subgraph Next.js
    MW[middleware: Auth.js JWT gate] --> RSC[Server components & server actions]
    RSC --> CTX[getContext: session → org → membership → permissions]
    CTX --> DAL[forOrg: tenant-scoped Prisma client]
    RSC --> SVC[Domain services: settings resolver, ledger*, ...]
    SVC --> DAL
    RSC --> ADP[Adapter registry]
  end
  DAL -->|"hearthstead_app role\nset_config(app.org_id)"| PG[(Postgres + RLS)]
  AUTH[Auth.js + Prisma adapter] -->|owner role| PG
  ADP --> MOCK[Mock providers]
  ADP -.-> REAL[Stripe · Twilio · Plaid · SMTP · LLM ...]
  JOBS[BullMQ workers*] --> DAL
  JOBS --- R[(Redis)]
```
<sub>* arrives in a later phase.</sub>

### Tenant isolation — two independent layers

1. **Data-access layer** (`src/server/dal`). Request code only ever gets a database handle
   from `forOrg({ orgId, userId })`. A Prisma extension injects `organizationId` into every
   `where`, stamps it on every `create`, adds `deletedAt: null` to reads, and throws
   `CrossTenantError` if code passes a different org id.
2. **Postgres row-level security** (`prisma/rls.sql`). The app connects as `hearthstead_app`,
   which is neither superuser nor table owner, and every table with `organizationId` has a
   `FORCE`d policy `"organizationId" = current_setting('app.org_id')`. Each query runs in a
   transaction that sets that variable first. No context → no rows.

`tests/integration/tenancy.test.ts` proves each layer holds *on its own*: raw SQL with the DAL
bypassed still cannot read or write another org's rows.

### The ledger (double-entry, single source of truth)

`src/server/ledger/postings.ts` holds the posting rules as pure functions; every one is unit-tested
to balance. `src/server/ledger/journal.ts` is the **only** code that writes journal entries: it
resolves system accounts, calls `assertBalanced`, and writes inside the caller's transaction, so
a business action and its accounting commit together or not at all.

| Action | Journal entry |
| --- | --- |
| Charge | Dr Accounts Receivable · Cr income (or Security Deposits Held) |
| Payment | Dr Undeposited Funds/Bank · Cr A/R (oldest open charge first) · excess Cr Prepaid Rent |
| Credit | Dr income/expense · Cr A/R (excess → Prepaid Rent) |
| Deposit received / refunded | Dr Deposit Cash · Cr Deposits Held / the reverse |
| Returned payment | Reverses the payment (charges reopen) + optional NSF fee charge |
| Void | Reversing entry; payments on a voided charge move to Prepaid Rent |
| Bill | Dr expense line(s) (property/unit) · Cr A/P per property |
| Bill payment | Dr A/P · Cr bank, split across the bill's properties |
| Expense | Dr expense line(s) · Cr bank |
| Vendor credit | Dr A/P · Cr the expense it refunds |
| Bank deposit | Dr bank · Cr Undeposited Funds (one pair per property) |
| Transfer | Dr destination bank · Cr source bank |
| Categorized bank-feed line | Dr/Cr bank against the chosen category |
| Owner distribution / contribution | Dr Owner Distributions · Cr bank / Dr bank · Cr Owner Contributions |
| Management fee | A bill from the management company (Dr Management Fees · Cr A/P), paid from the property's bank |

Balances are never stored. Lease balance = A/R − Prepaid Rent for that lease, computed from
journal lines. Integration tests (and `pnpm ledger:check`) assert after every scenario that
every entry balances, A/R equals the open charges, Prepaid equals unapplied payments, and A/P
equals open bills minus unapplied vendor credits.

**Reports** (`src/server/reports/engine.ts`) read the same journal. Cash-basis P&L = income and
expense lines in entries that move cash, plus tenant payments applied to income charges (dated by
the payment), plus bill payments spread over the bill's expense lines.

**Owner cash** (`src/server/accounting/owners.ts`): available to distribute per property =
operating bank + Undeposited Funds − Prepaid Rent − open payables − the property's reserve, all
read from journal lines carrying the property dimension. Security-deposit cash is never available.
Each owner's share follows ownership % with largest-remainder rounding.

**Nightly job** (`src/server/jobs/nightly.ts`): ends leases past move-out, posts recurring
charges due through today (prorated: daily rate = monthly ÷ days in month), and assesses late
fees from the settings resolver (grace, flat/percent, monthly max, optional daily accrual),
creates due recurring bills, and charges last month's management fees.
Both are idempotent via unique keys (`recurringChargeId + period`, `leaseId + key`).

### Settings inheritance

`src/server/settings/registry.ts` declares every setting once (Zod schema, default, allowed
scopes, UI input). `resolveSetting` (pure) and `getSetting(db, key, { orgId, propertyId?, leaseId? })`
return **lease ?? property ?? org ?? default**, plus where the value came from and what the scope
would inherit — which drives the "Inherited from Company / Override" UI. Invalid stored values
fall through to the next layer instead of crashing.

### Permissions

Per-module levels (`none < view < edit < delete`) on roles, optional property scoping on
memberships. Built-in roles: Admin, Property Manager, Bookkeeper, Maintenance, Vendor, Read-only
Owner; custom roles via Settings → Users & roles. `can()` is pure so the UI hides what you can't
do; `requirePermission()` re-checks on the server in every action.

### Folder structure

```
prisma/              schema.prisma, migrations/, rls.sql, apply-rls.ts, backfill.ts, seed.ts, seed-rentals.ts
scripts/dev.mjs      one-command dev (Windows/macOS/Linux)
src/
  app/
    (auth)/          login (password + magic link), signup, check-email
    app/             staff app (AppShell layout)
      @modal/(.)new/[kind]   intercepted "Create new" modal routes
      new/[kind]             full-page fallback for the same routes
      overview/ settings/ help/ [...section]/ (later-phase placeholders)
    portal/ apply/ l/        portals and public pages
    api/                     auth, search (and /api/v1 in Phase 10)
    dev/outbox               mock email viewer (dev only)
  components/
    ui/              shadcn-style primitives on Radix (button, dialog, field, money-input …)
    patterns/        DataTable, EmptyState, EntityHeader, StatCard, StatusBadge, Timeline …
    shell/           AppShell, SidebarNav, TopBar, CreateNewMenu, CommandPalette
  lib/               money (integer cents), nav config, shared Zod schemas
  server/
    dal/             tenant scoping (pure scopeArgs + Prisma extension)
    auth/            Auth.js config (edge-safe + full), password hashing
    permissions/     modules, levels, built-in roles, can()
    settings/        registry, resolver, service
    rentals/         properties, units, owners, portfolios (service + queries)
    records/         polymorphic notes & files
    importer/        CSV/XLSX import: validate, then write atomically
    ledger/          posting rules (pure), journal writer, proration/allocation/late-fee math
    leasing/         leases, lease money ops, late fees, read models
    jobs/            nightly job + all-org runner (BullMQ worker in scripts/worker.ts)
    payments/        online payments, status machine, autopay, mock settlement
    portal/          tenant portal context (login → tenant), invites, read models
    maintenance/     tasks, auto-assign, vendors, inspections (+AI summary), bills from invoices
    accounting/      payables, banking, reconciliation, owners & fees
    search/          global search provider registry
    actions/         server actions (uniform ActionResult)
  adapters/          third-party adapters; each has a working mock
tests/ unit/ integration/ e2e/
```

## Adapters

Every third-party service sits behind an interface with a working mock, so the app runs with zero
API keys. Select an implementation with its env var.

| Adapter | Env var | Implementations | Phase |
| --- | --- | --- | --- |
| EmailProvider | `EMAIL_PROVIDER` | `mock`, `smtp` | 1 ✅ |
| StorageProvider | `STORAGE_PROVIDER` | `local` (./storage), `s3` (MinIO / AWS) | 2 ✅ |
| AddressProvider | `ADDRESS_PROVIDER` | `mock` (offline autocomplete) | 2 ✅ |
| PaymentsProvider | `PAYMENTS_PROVIDER` | `mock`, `stripe` (Connect Express + Financial Connections) | 4 ✅ |
| InsuranceProvider | `INSURANCE_PROVIDER` | `mock` | 4 ✅ |
| BankFeedProvider | `BANKFEED_PROVIDER` | `mock` (mirrors the books with a 0–2 day lag + fees/interest), `plaid` (`PLAID_CLIENT_ID`, `PLAID_SECRET`); plus CSV import | 6 ✅ |
| SmsProvider | `SMS_PROVIDER` | `mock`, `twilio` | 8 |
| ScreeningProvider | `SCREENING_PROVIDER` | `mock` | 9 |
| ESignProvider | `ESIGN_PROVIDER` | `builtin` | 9 |
| ListingFeedProvider | `LISTINGFEED_PROVIDER` | `file` (XML/JSON feed) | 9 |
| AccountingExportProvider | `ACCOUNTING_EXPORT_PROVIDER` | `csv`, `quickbooks` | 10 |
| LlmProvider | `LLM_PROVIDER` | `mock`, `anthropic` (`ANTHROPIC_API_KEY`, `LLM_MODEL`, default `claude-sonnet-5-5`) | 5 ✅ (more in 10) |

**Swapping a mock for a real service:** set the env var (e.g. `EMAIL_PROVIDER=smtp`) and that
provider's credentials. To add an implementation, implement the interface in
`src/adapters/<name>/` and register it in `src/adapters/index.ts`.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| P1 | Foundation: repo, docker, auth, orgs, roles, app shell, design system, command palette, settings resolver | ✅ |
| P2 | Rentals: properties, units, owners, property wizard, importer | ✅ |
| P3 | Leasing & ledger: chart of accounts, ledger service, lease wizard, recurring/late-fee jobs | ✅ |
| P4 | Payments & tenant portal | ✅ |
| P5 | Maintenance: tasks, requests, work orders, vendors, inspections | ✅ |
| P6 | Accounting: bills, expenses, banking, reconciliation, distributions, management fees | ✅ |
| P7 | Reports + overview widgets | ✅ |
| P8 | Owner portal, communications, announcements, SMS | |
| P9 | Listings, showings, applications, screening, e-sign, renewals | |
| P10 | Public API, webhooks, workflows, AI assistant and agents | |

## Phase 7 demo script (Reports & dashboard)

1. **Overview**: eight live widgets (rent collected vs due, aging, occupancy, income vs expenses,
   expiring leases, open requests, bills due, cash). Each has **Details** to drill into the report
   or list behind it. **Showing** filters every widget to a property or portfolio.
2. **Customize**: drag widgets by the grip (or use the arrow buttons — keyboard friendly), hide the
   ones you don't need. The layout saves to your user. **View as** previews the Property manager,
   Bookkeeper or Maintenance layout; **Use this layout** adopts it. Widgets you lack permission for
   never render (and their data never reaches the browser).
3. **Reports**: 12 reports — P&L, balance sheet, cash flow, general ledger, transactions, rent roll,
   vacancy, lease expirations, delinquency & aging, deposits held, owner statement, 1099 summary.
4. Open **Profit & loss**: switch **Basis** (accrual/cash), **Columns** (by property / by month),
   **Compare to** previous period or last year. Click an account to drill into its general ledger.
5. **CSV** downloads the table; **PDF** opens a print-ready page (Save as PDF); **AI summary** writes
   2–3 sentences from the headline figures only (mock by default; `LLM_PROVIDER=anthropic` for Claude).

## Phase 6 demo script (Accounting)

1. Sign in as `admin@example.com` (or `books@example.com`) → **Accounting → Bills**. Stat cards show
   open, overdue and due-soon payables. Select a few open bills → **Pay selected** → one payment per bill.
2. **Create new → Bill**: pick a vendor, then **Split across properties** (equal, by units, by sq ft
   or custom %). Rounding always adds up. Toggle **Repeat monthly** to make it a recurring bill.
3. **Banking**: balances come from the ledger. Undeposited funds lists payments not yet banked —
   tick some and **Deposit**. Processor payouts deposit themselves.
4. Open **Operating Cash → Sync bank feed**. Exact hits auto-match; ambiguous ones offer suggestions
   (same amount, ±5 days). **Categorize** the monthly service fee to Bank Fees; **Import CSV** takes
   any bank export (Date, Description, Amount or Debit/Credit).
5. **Reconcile**: enter the statement date and ending balance, tick cleared items (those in the feed
   are pre-ticked) — **Finish** unlocks at a $0.00 difference. Last month is already reconciled.
6. **Owner distributions**: available cash per property and each owner's share; distribute selected
   properties in one click, or a custom split; record contributions.
7. **Settings → Management fees**: 8% of collected rent (min $50) with a flat override; **Accounting →
   Management fees** shows monthly runs, each a bill auto-paid from the property's bank.
8. `pnpm ledger:check` verifies every invariant, including A/P.

## Phase 5 demo script (Maintenance)

1. **Tasks**: table or **Board** (drag cards, or use each card's *Move to* select). Filter by type,
   status, priority, vendor; *Assigned to me*. Search `#1004` in ⌘K.
2. **Create new → Work order**: pick a category and see suggested vendors; leave *Email the work
   order* checked → the vendor's email lands in `/dev/outbox`.
3. Tenant portal (`tenant@example.com`) → **Requests → New request**: category, photos, permission
   to enter, preferred times. *Plumbing* requests auto-assign to Ace Plumbing + Priya
   (**Settings → Maintenance**). Staff reply with *Visible to the tenant* on → the tenant sees it
   on the request's timeline (and gets an email).
4. Sign in as `vendor@example.com`: only Ace Plumbing's jobs; comment and update status.
5. Open **#… Move-out inspection** (completed): room-by-room ratings, the **AI summary**
   (mock LLM — set `LLM_PROVIDER=anthropic` for Claude), and the **printable report**.
6. Open **Annual furnace service** → *Enter vendor invoice → bill* → posts Dr Repairs / Cr A/P,
   tagged to the property. Vendors → *Polar Air HVAC* shows an expired-insurance warning.
7. **Turn over Maple Court · 302** has subtasks — it can't be completed until they are.

## Phase 4 demo script (Payments & tenant portal)

Payments are connected on the **mock processor** (no keys), which behaves like Stripe test mode:

| Method | Test values | Behavior |
| --- | --- | --- |
| Card | `4242 4242 4242 4242`, any future expiry, any CVC | Succeeds instantly |
| Card | `4000 0000 0000 0002` | Declined |
| Bank (ACH) | routing `110000000`, any account number | Processing → succeeds after 2 days → paid out 2 days later |
| Bank (ACH) | account number ending `0002` | Fails at settlement (NSF) — the ledger payment is reversed |

1. Open http://localhost:3000/login?portal=1 on a phone-sized window; sign in as `tenant@example.com`
   (password tab, `Demo1234!x`) or use the email link. Home shows the balance and **Pay now**.
2. **Pay** the full balance by bank → "Payment submitted"; home now shows $0.00. Add a card, pay
   $100 and see the 2.9% + 30¢ card fee (pass-through is a setting; ACH is free by default).
3. **Autopay**: pick a day; the schedule is spelled out. **Insurance**: upload a declarations page.
4. As `admin@example.com`: **Accounting → Incoming payments** shows the timeline
   (initiated → processing → succeeded → paid out); expand a row and use *Simulate: clears* or
   *Simulate: ACH return* (the return reverses the ledger payment). *Run mock settlement* does
   what the nightly job does.
5. **People → Tenants**: select rows → *Invite to portal* (emails in `/dev/outbox`).
   Open a tenant → **Preview portal as** (read-only, with a banner).
6. **Settings → Payments**: processor status, fee pass-through, payment application order.

**Going live with Stripe:** set `PAYMENTS_PROVIDER=stripe`, `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET`, then *Settings → Payments → Connect payments* sends you through Stripe
Express onboarding. In Stripe mode card and bank details must be tokenized in the browser with
Stripe Elements / Financial Connections (the adapter only accepts `pm_…`/`fca_…` ids); the
mock-mode forms post raw test numbers to the server and keep only the last 4 digits.

## Phase 3 demo script (Leasing & ledger)

The seed simulates **50 leases with up to 18 months of history** through the real ledger:
on-time payers, late payers (with late fees), partial payers, a bounced check, an eviction and
three turnovers.

1. **Overview**: occupancy, collected this month, outstanding balances.
2. **Leasing**: 47 active leases, rent roll, tenants owing. Open **Expiring / renewals**.
3. **New lease** → Harborview Condos · 101 (vacant). Try Maple Court · 101 instead to see the
   overlap error with a link to the conflicting lease. Add a co-tenant, set rent, watch the
   proration preview, override the grace period for this lease, *Create lease*.
4. On the lease: **Receive payment** (pre-filled with the balance) → balance $0.00.
   **Post charge** → **Transactions** → *Void…* with a reason. *Mark as returned (NSF)* on a
   payment → charges reopen and a $35 NSF fee posts.
5. **More → Move out**: credits the unused days of the final month. **Statement** prints.
6. **Accounting → Chart of accounts**: balances computed from the journal. **Journal entries**:
   a manual entry can't be posted until it balances; voiding posts a reversal.
7. **Files → Import → Leases**: `tests/e2e/fixtures-data/leases.csv` brings in tenants, deposits
   and opening balances (positive = owed, negative = credit).
8. **Run rent & late fees** (Leasing page) — idempotent; run it twice.

## Phase 2 demo script (Rentals)

Sign in as `admin@example.com`. The seed has **3 portfolios, 12 properties, 60 units and 9 owners**.

1. **Rentals → Properties**: filter by *Commercial* portfolio, search "ironbridge", export CSV.
2. **Add property** (opens over the page): try *Next* with nothing selected → inline error.
   Pick *Multi-family*, type `418 oak` in the street field and pick a suggestion (fills city/state/ZIP).
   On *Units*: duplicate a row, *Add unit* (names auto-increment), watch the rent total.
   On *Owners*: quick-create "Rosa Delgado" → 100% ✓. *Review* → *Create property*.
3. Pick *Single-family* in the wizard → exactly one unit named "Main", no add button. *Save as draft*, reopen → "Draft restored".
4. **Maple Court → Settings**: Grace period is a *Custom property value* (7 days); flat fee shows
   *Inherited from Company: $75.00*. Toggle *Override* to customize just this property.
5. **Maple Court → Owners**: edit the split (must total 100%, *Split evenly* helps). **Notes** / **Files**: add a note, drag in a PDF.
6. **Files → Import**: *Download template*, or drop `tests/e2e/fixtures-data/properties.csv` → columns auto-map →
   *Validate* → *Import*. Try `bad.csv` to see per-row errors (nothing is written).
7. **People → Owners → Dana Whitfield**: properties with shares, tax ID shown as last 4 only.
8. **⌘K** → "harborview", "whitfield", "suite".
9. **Settings → Users & roles**: Marco (Maintenance) has *4 properties* access. Sign in as `maint@example.com`
   → only the North Side properties appear.

## Phase 1 demo script

1. `pnpm dev`, open http://localhost:3000 → redirected to **Sign in**.
2. Sign in as `admin@example.com` / `Demo1234!x` → **Overview** with the Getting Started checklist.
3. Press **⌘K / Ctrl+K**, type `priya` → pick *Priya Manager* → Users & roles.
   Type `grace` → jump straight to the late-fee setting.
4. Click **Create new → User** → a modal opens *over* the current page (URL `/app/new/user`).
   Submit empty to see inline validation, then invite someone → toast, row appears.
5. **Settings → Fees & late fees**: Grace period shows *Custom company value* (seeded); toggle
   *Customize* on "Maximum late fees", set $200 → toast. Toggle off → *Using default* with **Undo**.
6. Change Marco's role inline (optimistic); remove Olivia → confirm dialog → **Undo**.
7. Account menu → switch to **Harbor Light Rentals** → late-fee grace is 10 days there, and as a
   Property Manager in that org you can view but not edit.
8. Sign out, use **Email link** for `pm@example.com`, open `/dev/outbox`, click the link.
9. Sign in as `vendor@example.com`: the sidebar only shows Overview, Tasks and Files.
10. Toggle dark mode (account menu), collapse the sidebar, resize to 360px for the mobile drawer.

## Assumptions

See [docs/ASSUMPTIONS.md](docs/ASSUMPTIONS.md).
