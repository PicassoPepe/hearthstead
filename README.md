# Hearthstead

Multi-tenant property management for landlords and property managers: rentals, leasing, a
double-entry ledger, tenant and owner portals, maintenance, accounting and reporting.

> **Status: Phase 2 (Rentals) complete.** See [Roadmap](#roadmap) for what each phase adds.

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
| Vendor | `vendor@example.com` |
| Read-only Owner | `owner@example.com` |
| Admin of "Harbor Light Rentals" | `harbor@example.com` |

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
    accounting/      chart of accounts (ledger arrives in Phase 3)
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
| PaymentsProvider | `PAYMENTS_PROVIDER` | `mock`, `stripe` (Connect Express + Financial Connections) | 4 |
| InsuranceProvider | `INSURANCE_PROVIDER` | `mock` | 4 |
| BankFeedProvider | `BANKFEED_PROVIDER` | `mock`, `plaid` | 6 |
| SmsProvider | `SMS_PROVIDER` | `mock`, `twilio` | 8 |
| ScreeningProvider | `SCREENING_PROVIDER` | `mock` | 9 |
| ESignProvider | `ESIGN_PROVIDER` | `builtin` | 9 |
| ListingFeedProvider | `LISTINGFEED_PROVIDER` | `file` (XML/JSON feed) | 9 |
| AccountingExportProvider | `ACCOUNTING_EXPORT_PROVIDER` | `csv`, `quickbooks` | 10 |
| LlmProvider | `LLM_PROVIDER` | `mock`, `anthropic` | 10 |

**Swapping a mock for a real service:** set the env var (e.g. `EMAIL_PROVIDER=smtp`) and that
provider's credentials. To add an implementation, implement the interface in
`src/adapters/<name>/` and register it in `src/adapters/index.ts`.

## Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| P1 | Foundation: repo, docker, auth, orgs, roles, app shell, design system, command palette, settings resolver | ✅ |
| P2 | Rentals: properties, units, owners, property wizard, importer | ✅ |
| P3 | Leasing & ledger: chart of accounts, ledger service, lease wizard, recurring/late-fee jobs | |
| P4 | Payments & tenant portal | |
| P5 | Maintenance: tasks, requests, work orders, vendors, inspections | |
| P6 | Accounting: bills, expenses, banking, reconciliation, distributions, management fees | |
| P7 | Reports + overview widgets | |
| P8 | Owner portal, communications, announcements, SMS | |
| P9 | Listings, showings, applications, screening, e-sign, renewals | |
| P10 | Public API, webhooks, workflows, AI assistant and agents | |

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
