# Going live — checklist

Work top to bottom. Each step says **who** does it. The hosted app is Cloudflare Workers Paid
(about $5/month) plus a domain (about $11/year). Neon, R2, Resend, and Workers AI stay on free
tiers. Railway is legacy: leave it up until this checklist passes, then cancel it.

## 1. Put the app online — you (about 30 minutes)

- [ ] Follow [DEPLOY-CLOUDFLARE.md](./DEPLOY-CLOUDFLARE.md) and the secret list in [OPERATIONS.md](./OPERATIONS.md).
- [ ] Neon is already created (project `rough-wind-47929745`). Paste `DATABASE_ADMIN_URL` (direct, user `deedwood_owner`) and `DATABASE_URL` (pooled, user `deedwood_app`) into GitHub Actions secrets. Do not add a secret that resets that password.
- [ ] Workers Paid, R2 bucket `deedwood-uploads`, and a Resend API key, then the other secrets in OPERATIONS.md.
- [ ] GitHub → Actions → **Deploy to Cloudflare** → Run workflow.
- [ ] Optional: `BACKUP_KEY` (write it down; backups cannot be restored without it) and `PLATFORM_ALERT_EMAIL`.
- [ ] Leave `PAYMENTS_ENABLED` and `BILLING_ENFORCED` unset.
- [ ] Open `https://<your app>/api/health` — `"ok": true`, `"payments": "off"`.

## 2. Real email — you (15 minutes)

Sign-in links, password resets, invites and notices need it.

- [ ] Make a free account at resend.com (3,000 emails/month free), add your domain, and add the
      DNS records it shows you.
- [ ] Worker secret `RESEND_API_KEY`, and `EMAIL_FROM=DeedWood <no-reply@yourdomain.com>`.
      The Worker var `EMAIL_PROVIDER` is already `resend` (HTTPS). Do not set an SMTP URL on Cloudflare.
- [ ] Test: on the sign-in page use **Forgot password?** with your email — the email should arrive.

## 2b. Sign-up protection and "Sign in with…" — you (20 minutes, all free)

New accounts always confirm a 6-digit code by email (or text). These add more:

- [ ] **"I'm human" check (Cloudflare Turnstile):** dash.cloudflare.com → Turnstile → Add widget →
      your app's domain → copy the two keys into Worker secrets: `TURNSTILE_SITE_KEY`,
      `TURNSTILE_SECRET_KEY`. It then appears on sign-up, email sign-in links, forgot password and
      the contact/tour forms on company websites.
- [ ] **Sign in with Google:** console.cloud.google.com → APIs & Services → Credentials → Create
      credentials → OAuth client ID → Web application. Authorized redirect URI:
      `https://<your app>/api/auth/callback/google`. Put the ID and secret in `AUTH_GOOGLE_ID`,
      `AUTH_GOOGLE_SECRET`.
- [ ] **Sign in with Microsoft:** portal.azure.com → App registrations → New registration →
      "Accounts in any organizational directory and personal Microsoft accounts" → Redirect URI
      (Web): `https://<your app>/api/auth/callback/microsoft-entra-id`. Then Certificates & secrets →
      New client secret. Put them in `AUTH_MICROSOFT_ENTRA_ID_ID`, `AUTH_MICROSOFT_ENTRA_ID_SECRET`.
- [ ] **Codes by text message (optional):** a Twilio account with a phone number (US numbers
      need A2P 10DLC or toll-free verification): `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`,
      `TWILIO_AUTH_TOKEN`, `SMS_FROM`. Without it, sign-up codes go by email only.

The buttons and checks appear automatically once their keys are set; nothing else to change.

## 3. Your owner console — you (10 minutes)

- [ ] On your own computer, with `DATABASE_ADMIN_URL` set to the Neon **direct** URL in the environment (do not print it) and `PLATFORM_OWNER_EMAIL` set: `pnpm platform:owner`. Open the link, set a password, and turn on two-factor.
- [ ] Owner console → **System health**: everything green; press **Back up now** once.

## 4. Watch it — you (5 minutes)

- [ ] Free uptime alert: uptimerobot.com → New monitor → HTTPS → `https://<your app>/api/health`
      → alert to your email/phone.
- [ ] Optional: a free Sentry account; put its DSN in `SENTRY_DSN` for detailed error reports.

## 5. Marketing website — you (15 minutes)

- [ ] [DEPLOY-CLOUDFLARE.md](./DEPLOY-CLOUDFLARE.md): **Make Website Folder.bat**, drag the folder into
      Cloudflare Pages, connect your domain.
- [ ] Google Search Console + Bing Webmaster: verify the domain, submit `/sitemap.xml`
      ([SEO_MONTHLY.md](./SEO_MONTHLY.md)).

## 6. Before charging anyone — you + lawyer

- [ ] Attorney reviews the Terms and Privacy pages (they're marked as drafts until then).
- [x] Stripe sandbox catalog (products, prices, `DEEDWOODBETA` promo) — done.
- [ ] Worker secrets: `STRIPE_SECRET_KEY` (sk_test_…) and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (also a GitHub Actions secret, because the publishable key is baked in at build time).
- [ ] Stripe → Developers → Webhooks → add `https://<your app>/api/webhooks/stripe` with these events:
      `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
      `customer.subscription.deleted`, `customer.subscription.paused`, `customer.subscription.resumed`,
      `invoice.paid`, `invoice.payment_failed`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
- [ ] Stripe → Settings → Billing → Customer portal: allow updating cards and canceling.
- [ ] Give your first beta landlord free access: owner console → Companies → their company →
      **Make free (beta)** (no card needed). Or give them the `DEEDWOODBETA` code at checkout.
- [ ] When you're ready for companies to pay after their 14-day trial, set `BILLING_ENFORCED=1`.
      Until then nobody is ever locked out. Even then nothing is deleted — unpaid accounts go read-only.
- [ ] Going live with real money: only after you approve it — switch to `sk_live_` keys and set
      `STRIPE_LIVE_APPROVED=1`.

## 7. Practice a restore once — you + Claude (15 minutes)

You should know a restore works *before* you need it. On a copy (a Neon branch, or your own computer):

1. Owner console → System health → download the newest backup.
2. On the copy, with the same `BACKUP_KEY`: `pnpm db:restore --file deedwood-….dwb --yes`
3. Sign in and check a few properties and balances.

### Restore a backup (real emergency)

`pnpm db:restore --latest --yes` on a computer that has the backup file and the same `BACKUP_KEY`
(not inside the Worker). It **replaces everything** in the database that command is pointed at.
On a computer install, close DeedWood first, open a terminal in the DeedWood folder and run the
same command.

## Already done in the code

Security headers, sign-in limits and lockout, two-factor, password reset and email
confirmation, row-level data isolation, audit logs, nightly encrypted backups (newest 14 kept),
error recording + alert emails, `/api/health`, search-engine setup, and "coming soon" for online
payments.
