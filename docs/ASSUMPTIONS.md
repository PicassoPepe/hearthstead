# Assumptions & defaults

Decisions made without asking, per the brief. Each can be changed later.

**Product**
- App name **DeedWood**. Official palette (DeedWood LLC; logos in `public/` and `docs/brand/`, used
  as-is): deep teal **#0C4C54** primary, dark slate **#18383B** text, copper **#B8774F** accent,
  ivory **#F7F3EA** page background (never pure white, for less eye strain). Dark mode uses a soft
  charcoal teal background (#121C1E) and a lighter teal (#4DB0B8) primary. The `{{EXTRA_CONTEXT}}` placeholder was empty.
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
- Active org is a cookie (`dw_org`) validated against memberships on every request; falls back
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

**Phase 7 (Reports & dashboard)**
- Reports are computed live from journal lines and the lease subledger (no snapshots); very large
  ledger listings are capped at 3,000 lines with a note to narrow the range.
- Cash basis: income is recognized when a tenant payment is *applied* to an income charge (dated by
  the payment); unapplied prepayments aren't income until applied. Expenses are recognized when a
  bill is paid (spread across its lines) or when paid directly.
- Aging buckets use each open charge's due date vs the "as of" date. Delinquency lists leases with a
  positive net balance (charges − credits).
- The balance sheet rolls all-time net income into equity ("Net income (to date)"); there is no
  year-end close yet. A property-filtered balance sheet may not balance if company-level entries
  have no property; the report says so.
- PDF export is the browser's print-to-PDF of a print-styled page (no server-side PDF renderer).
- AI summaries receive only the computed headline figures, are audit-logged, and are labeled.
- Dashboard layout (order + hidden) is stored per user in `User.preferences.dashboard`; role
  presets are suggestions. "View as" previews a preset — it does not impersonate a user.
- Chart colors use the validated categorical palette (checked for color-vision deficiency and
  contrast in both themes); every chart has a legend, direct labels or a table alternative.

**Phase 8 (Owner portal & communications)**
- Owner logins are ordinary Users linked to Owner records (`OwnerUser`); a login with no staff
  membership is routed to its tenant or owner portal. The demo `owner@example.com` is an owner-portal
  login (Grace Harmon); the built-in "Owner (read-only)" staff role still exists for staff use.
- The owner portal reuses the report engine with a context whose property scope is exactly the
  owner's properties, so filters can only narrow it. Amounts on statements are property totals with
  the owner's share computed by ownership %.
- One conversation per contact (tenant, owner, vendor or unknown number) holds every channel.
  Inbound SMS is routed to the organization that last texted that number, else by matching a
  contact's phone; unknown numbers get their own thread.
- SMS: US numbers only (normalized to +1XXXXXXXXXX), segments metered per calendar month against a
  company limit; STOP/START keywords are honored. The mock "delivers" every valid number except ones
  ending in 0000 (simulated carrier failure).
- Announcement delivery is idempotent per (recipient, channel). Portal announcements are the
  delivery rows themselves; SMS announcements are also logged in the recipient's conversation.
- AI drafts and rewrites go through `LlmProvider`, are labeled in the UI and audit-logged, and are
  never sent without a person pressing Send.

**Phase 9 (Leasing funnel)**
- One active listing per unit; publishing requires a description and a unit without an active
  lease. Public pages live at `/l/<org-slug>` (no login); the org is resolved by slug and every
  query then runs through the org-scoped client.
- Self-scheduled showings: hourly slots 10am–6pm (org timezone) over the next 7 days, minus booked
  ones. Staff can schedule any time; overlapping showings for the same listing are refused.
- Applicants don't create accounts: a random resume token lives in an httpOnly cookie and only its
  SHA-256 is stored; starting again with the same email resumes the draft. One applicant per
  application (co-applicants apply separately and are linked by staff when creating the lease).
- The application fee is charged through PaymentsProvider and posted Dr Undeposited Funds /
  Cr Application Fee Income with the property dimension. Fees are non-refundable.
- Screening runs on submit with recorded consent (time + IP). Recommendations are advisory; staff
  decide. Declines always send an adverse action notice with the reasons and FCRA rights.
- E-signature (built-in): the rendered document is frozen and hashed when sent; signers type their
  exact name and tick consent; tenants sign first and the sender countersigns (fresh link emailed
  when it's their turn). Completion stores an HTML copy plus certificate on the lease.
- Renewals: suggested rent = max(current + 3%, market) rounded to $5. Accepting creates a new lease
  starting the day after the current one ends (same tenants and charges, new rent) and sets the old
  lease's move-out to its end date. The security deposit stays on the original lease's ledger.

**Phase 10 (Platform)**
- API keys look like `dw_live_<8 hex>_<secret>`; only the prefix and a SHA-256 of the whole key are
  stored. Keys are read-only or read/write; `dw_test_` keys act on the organization's sandbox (a
  separate, clearly-labeled org with sample data — the same tenancy and RLS rules apply).
- Rate limiting is a fixed one-minute window per key in Redis (in-process fallback if Redis is
  down). Idempotency records are kept 24 hours per (key, Idempotency-Key) with a request hash.
- The public API covers properties, units, tenants, leases (+ balance, transactions, charges) and
  tasks. Writes go through the same domain services as the app, so ledger rules always apply.
- Webhooks are signed Stripe-style (`t=…,v1=HMAC-SHA256(secret, t.body)`), sent once inline and
  retried by the minutely worker at 1m, 5m, 30m, 2h, 12h, then marked dead (manual retry available).
  Production requires https endpoints.
- Workflows trigger on the same events; conditions are ANDed; runs are idempotent per
  (workflow, event); events caused by workflow actions don't trigger workflows (no loops).
- The assistant never writes on its own: write tools return proposals; confirming executes with the
  user's own permissions and is audited as AI-initiated. The mock model routes common questions to
  tools deterministically; with `LLM_PROVIDER=anthropic` Claude chooses tools itself.
- Agents act only on items they haven't handled (unique per agent/kind/item). In Auto mode they
  act when confidence ≥ the threshold; legal/safety/repair messages get low confidence by design.
- 2FA is TOTP (RFC 6238) with 8 single-use recovery codes (hashed). Email-link sign-in is refused
  for 2FA accounts. Sessions are recorded per sign-in; revoking one takes effect within a minute.
- Billing is illustrative (plan math and usage only); no charges are made.

**Known limitations (deliberate scope cuts)**
- Real-provider adapters (Stripe, Twilio, Plaid, QuickBooks OAuth, Anthropic) are implemented
  against their documented REST APIs but exercised in tests only through the mocks.
- PDFs are produced by the browser's print-to-PDF from print-styled pages; there is no server-side
  PDF renderer. Signed e-sign copies are stored as self-contained HTML with the audit certificate.
- Billing shows plan math and usage only; it doesn't charge.

## Improvement round (after Phase 10)

**Onboarding**
- Sign-up lands on a 4-step setup guide (company + logo, properties, payments, team). "Explore with
  sample data" builds the company's *sandbox* (the same isolated org that `dw_test_` API keys use)
  with sample properties, photos, leases, tasks and a listing, and switches to it. Real books stay empty.
- Portal welcome steps (tenant, owner, vendor) are dismissible per device (localStorage) and
  disappear once everything is done.

**Images**
- Logos, avatars and property/unit photos are stored as attachments flagged `public` and served
  without login at `/api/images/<id>` (unguessable ids) so portals, the listings site and the feed
  can show them. Inspection photos are private and go through the authenticated file route.
- The first photo is the cover. A unit without photos falls back to the property's photos.
- Demo photos and the demo logo are generated procedurally (a tiny PNG encoder) — no binary assets in git.

**Notifications & reminders**
- The bell is fed from domain events (tenant requests, online payments, failed payments,
  applications), inbound portal/SMS messages, completed e-signatures, owner decisions, vendor
  invoices and agent proposals. A person is never notified about their own action. Recipients are
  members whose role can view the relevant module and whose property scope covers the property.
- Rent reminders run nightly after charges and autopay: before-due (skipped when the lease is paid
  ahead; mentions autopay when it's on) and past-due (only with a balance). Email always; SMS when
  enabled and the tenant isn't opted out. One reminder per lease, kind and due date.
- Owner statements email on the 1st (cash basis, previous month) when the owner-portal setting is
  on; one per owner per month. "Email last month's statements" sends them on demand.

**Daily operations**
- Recurring charges never rewrite history: a change takes effect on or after the next unposted
  month (it ends the old charge the day before and starts a new one; both prorate). Bulk rent
  increases use the same rule and can email a rent-change notice. Local notice-period law is not
  enforced — choose an effective date that complies.
- Keys & spaces: paid parking/storage assigned to a lease adds a prorated recurring charge; returning
  it ends the charge (never before what's already billed).
- Joint applications: co-applicants and guarantors each complete their own application (own fee,
  consent and screening) via an emailed link. Approving the primary approves everyone who has
  submitted. Household income excludes guarantors. The lease wizard adds co-applicants as co-tenants
  and guarantors as cosigners.
- The calendar is computed from existing data (no separate events table).

**Money**
- Budgets store 12 monthly amounts per income/expense account (company-wide or per property);
  "budget vs actual" uses accrual actuals; variance is favorable-positive for both income and expense.
- Year-end close posts a closing entry per property (so owner reporting stays right) moving net
  income to Retained Earnings, dated Dec 31, and locks the books through that date (no posting or
  voiding on or before it). P&L reports exclude closing entries. Close years in order; only the
  latest closed year can be reopened (its closing entry is reversed).
- 1099-NEC export: IRS IRIS-style CSV plus printable recipient copies. Only the last 4 digits of a
  vendor's TIN are stored, so the CSV marks each TIN to be completed from the W-9 before upload.
- Utility billback (RUBS) allocates a month's utility expense (from the ledger, or entered) across
  leases occupied that month: by sq ft, occupants (non-cosigners, min 1), equally, or 50/50. A
  recovery % leaves the common-area share with the owner. One billback per property/month/account.
- Owner approvals: bills at or above the property's threshold (default off) need an owner's
  approval in the portal before payment; a decline blocks payment until the bill is voided.
- Vendor invoices are submitted by vendor logins and become bills only after staff review.

**Mobile**
- Below 768px every data table renders as cards (first column as title), staff get a bottom tab bar
  with a quick-actions sheet, and toasts sit above the bar. The switch happens after hydration, so
  the server always renders the desktop table.

**Known limitations (current)**
- Real-provider adapters (Stripe, Twilio, Plaid, QuickBooks OAuth, Anthropic) are implemented
  against their documented REST APIs but exercised in tests only through the mocks.
- PDFs come from the browser's print-to-PDF; signed e-sign copies are self-contained HTML.
- Images aren't resized server-side (8 MB cap per image).
- The 1099 export needs full TINs added by hand (only last 4 are stored by design).
- Billing shows plan math and usage only; it doesn't charge.

## Land records (parcels, owner of record, deeds)

- Lookup chain (`PARCELS_PROVIDER=auto`): the free US Census geocoder turns the address into
  coordinates and a county FIPS code; counties in `src/adapters/parcels/counties.ts` are queried
  directly on their public ArcGIS parcel layer (free); other counties use Regrid when
  `REGRID_TOKEN` is set (paid, per record); otherwise the page says the county isn't connected yet.
  `PARCELS_PROVIDER=mock` gives deterministic sample parcels (demo data, tests); `off` disables it.
- Kentucky addresses are placed on the building with the statewide **Kentucky 911 site/structure
  address points** (kygisserver.ky.gov) when one is within 2 km of the Census point — the Census
  geocoder interpolates along the street centerline, which otherwise lands in the road right-of-way.
- **Free county coverage in Kentucky is thin.** A survey of every public ArcGIS layer inside Kentucky
  (Nov 2026) found only one official, current county parcel layer with outlines: Jefferson County
  (LOJIC — outlines and parcel IDs, no owner names). Other hits were stale (Shelby 2017), unofficial
  (a 2023 sanitation-district snapshot for Northern Kentucky), missing owner names (Warren), or in
  neighboring states. Kentucky's open-data portal has parcels only for Webster County. Most PVA
  offices publish through qPublic/Schneider, which doesn't allow automated access. **Wayne County, KY
  has no public parcel layer** (a "Wayne County Land Parcels" layer on ArcGIS Online is Wayne County,
  Michigan). So for statewide Kentucky coverage — including Wayne County — set `REGRID_TOKEN`;
  Jefferson County stays free. Add more free counties to `counties.ts` as they publish official
  layers.
- Records are stored (`ParcelRecord`, one per property) and refreshed every 90 days by the nightly
  job, so paid lookups happen rarely. New properties are looked up in the background when created.
  If a refresh fails, the last good data stays and the error is shown.
- Owner-of-record check: every owner on file must share a significant name word with the county's
  owner name (LLC/INC/TRUST/ETAL and punctuation ignored). It's a prompt to check the deed, not a
  legal determination.
- Deeds and title: county clerk and PVA (qPublic) sites don't allow automated access, so DeedWood
  links to them and stores attached deed / title policy / survey / plat PDFs (owners see them).
  Title searches come from a title company. Parcel outlines are approximate (not surveys); the UI
  says so.
- Map tiles: OpenStreetMap (street) and Esri World Imagery (satellite), loaded by the viewer's
  browser with attribution. High-traffic hosted installs should use a tile provider account.

## Security hardening (ship plan, Phase 1)

- **Cookies** go through `src/lib/cookies.ts`: httpOnly, SameSite=Lax, and `secure` whenever
  `AUTH_URL` is https (or in production without an AUTH_URL). The one-click local install runs on
  `http://127.0.0.1`, where a secure cookie would be dropped, so it stays non-secure there.
- **Headers** (`src/lib/security-headers.ts`, applied in `next.config.ts`): CSP with
  `frame-ancestors 'none'`, HSTS, nosniff, DENY framing, strict referrer, a narrow Permissions-Policy.
  `script-src` still allows `'unsafe-inline'` for Next's bootstrap scripts; moving to nonces is a
  later tightening. Allowed outside hosts: OpenStreetMap/Esri map tiles and Stripe.js.
- **Sign-in limits** (`src/server/auth/rate-limit.ts`): enforced inside the password provider, so
  they also cover direct calls to Auth.js. Per-address limits apply only when the address is known
  (behind the hosting proxy); the per-account lockout always applies. Redis when `REDIS_URL` is set,
  otherwise in-process memory.
- **CSRF:** Server Actions rely on Next's built-in Origin/Host check; `tests/e2e/security.spec.ts`
  proves a cross-site post is refused. No separate token system.
- **SecurityEvent** is a platform-level table (not company-scoped); the app's database role has no
  access to it. Failed sign-ins store a SHA-256 of the email, not the email.

## Owner console (ship plan, Phase 2a)

- `/admin` is a separate App Router tree. Access needs a `PlatformAdmin` row (never an org role),
  two-factor on, and (optionally) an allowed IP. Risky actions (pause a company, reset someone's
  two-factor, "view as") also ask for a fresh two-factor code.
- Platform tables have no `organizationId` and the app role has no grants on them; `/admin` uses the
  admin connection only. A test proves `deedwood_app` gets "permission denied".
- "View as" stores an `Impersonation` row (reason, ≤ 60 minutes) and a cookie; the staff app then
  runs as that member with `impersonatorId` on the database context, so every company audit row
  records the owner. A banner stays visible with "Stop viewing".
- Paused companies keep all data; staff see a "paused" page; server actions refuse.
- Feature switches: company row → everyone row → built-in default. Wired today: `sms` (sending),
  `ai` (AI helper page), `api` (public API). Others are available for new features to read.
- The owner bootstrap is a script (`pnpm platform:owner`); there's no sign-up path to the role.
  It prints an Auth.js-compatible one-time email sign-in link.

## Plans & licenses (ship plan, Phase 2b)

- **Plan** rows hold the accepted prices (Starter $49 flat; Growth $2.50/unit, $99 min; Scale
  $1.75/unit, $175 min, $1.50 above 250; Local $15/unit/year, $199 min; Care +$249; add-ons). The
  backfill adds missing plans only, so /admin edits are never overwritten. `quote()` is the one
  price formula.
- **Feature keys** (`src/lib/entitlements.ts`) per plan; the `Entitlement` table is in place for
  codes/purchases (Phase 2e). Hosted entitlement is still unenforced until billing (Phase 2c).
- **Licenses:** Ed25519, `DW1.<claims>.<sig>` over canonical JSON. The private key exists only in
  the host's env; the public key is committed by `pnpm license:keygen`. **Until that's run, computer
  installs are not limited** (so existing installs keep working).
- Computer installs (`DEEDWOOD_DEPLOYMENT=LOCAL`, set by `scripts/start.mjs`): no license → 30-day
  trial from first start; past the end date → 14 grace days; then read-only (all writes except
  Settings are refused server-side in `requirePermission`; viewing and exporting still work). The
  unit limit is checked when adding properties/units. Daily check-in (only if
  `LICENSE_CHECKIN_URL` is set) installs renewals and applies revocations and update notices.

## Company websites (ship plan, Phase 3A)

- Content is block JSON validated by Zod (`src/lib/site/blocks.ts`); all text renders as plain
  text, so there is no HTML/XSS surface. Image ids must look like attachment ids; button targets
  are a fixed list. Each section has an on/off switch that never deletes content.
- Draft → Publish (every publish is a `WebsiteVersion`; History restores one) → visitors see the
  published copy. `live=false` hides the site without deleting it. Staff of the company can preview
  the draft at `/s/<slug>?preview=1` (shown in the editor's iframe; `/s/*` allows same-origin
  framing, everything else still denies framing).
- Addresses: `/s/<slug>` always; `<slug>.SITES_ROOT_DOMAIN` and custom domains are rewritten by
  the middleware (custom domains resolved through `/api/sites/resolve`, cached 5 minutes).
- Available homes come from published listings via the org-scoped client (RLS isolation tested).
- Contact/tour forms: honeypot + per-address rate limit; messages create or update a Prospect
  (source WEBSITE) and notify leasing staff. Turnstile/hCaptcha can be added later.
- Theme colors are adjusted automatically to keep AA contrast; Equal Housing footer is fixed.
- Not yet: plan-gating of site features (needs billing, Phase 2c), multi-page sites/blog posts,
  Lighthouse CI.

## Marketing site, SEO S0 and the payments switch

- Marketing pages live in `src/app/(marketing)`; `/` shows them to signed-out visitors and still
  sends signed-in people to their workspace. Copy only claims what exists today.
- SEO S0: per-page title/description/canonical (`metadataBase` = `SITE_URL`), Open Graph,
  `robots.ts`, `sitemap.ts` (marketing + company websites without their own domain),
  `X-Robots-Tag: noindex` on every private path, Organization/SoftwareApplication/FAQ JSON-LD,
  never self-serving ratings. Lighthouse runs on a labeled PR (free-minutes friendly).
- Cloudflare: the marketing pages are exported as static files (`scripts/export-marketing.mjs`)
  for Pages "Upload assets". The app stays on a Node host for now (Workers would need storage,
  Prisma, jobs and Redis changes) — see docs/DEPLOY-CLOUDFLARE.md.
- `PAYMENTS_ENABLED` (default off): startPayment, savePaymentMethod, connectProcessor and
  payApplicationFee refuse; autopay runs do nothing; portal pages say "coming soon"; applications
  can be submitted without paying the fee online. Tests and the demo seed switch it on.
- Not yet (later SEO phases): MDX content engine, Kentucky guide, calculators, comparisons,
  glossary, Spanish hreflang, IndexNow, listing-page JSON-LD, builder SEO score.

## Launch-critical: password reset, email confirmation, backups, alerts

- Password reset / email confirmation use `AccountToken` (SHA-256 of the token stored; newest
  link only; 30 min / 3 days; single use claimed atomically). Reset revokes all sessions, clears
  the lockout and confirms the email. Existing users were backfilled as confirmed. API keys and
  connecting payments need a confirmed email. (2FA-required-for-admins and passkeys: later.)
- Backups: no pg_dump dependency — every table is read with `row_to_json` and restored with
  `json_populate_recordset` in foreign-key order inside one transaction, gzip + optional
  AES-256-GCM (`BACKUP_KEY`). Stored through the storage adapter (Railway `/data` volume or S3),
  nightly before the jobs, newest `BACKUP_KEEP` kept. A test restores a full backup and compares
  every table's row count.
- Errors: `ErrorEvent` (platform-only) from server actions, API 500s, jobs, and Next's
  `onRequestError`; alert email ≤ 1/hour; optional Sentry via its store endpoint (no SDK).
- `/api/health` for uptime monitors. Go-live steps: docs/LAUNCH.md.
