# Going live — checklist

Work top to bottom. Each step says **who** does it. Nothing here costs money except the domain
(about $12/year) and Railway (about $5–10/month to start).

## 1. Put the app online — you (about 30 minutes)

- [ ] Follow [DEPLOY.md](./DEPLOY.md): Railway project, Postgres, the `/data` volume, settings.
- [ ] Settings to add in Railway → Variables (besides the ones in DEPLOY.md):
  - `BACKUP_KEY` — a long random phrase. **Write it down somewhere safe**: backups are encrypted
    with it and can't be restored without it.
  - `PLATFORM_ALERT_EMAIL` — your email, to hear about errors (at most one email an hour).
  - `SITE_URL` — your marketing address (e.g. `https://deedwood.com`).
  - Leave `PAYMENTS_ENABLED` **unset** until Stripe is ready.
- [ ] Open `https://<your app>/api/health` — it should say `"ok": true`.

## 2. Real email — you (15 minutes)

Sign-in links, password resets, invites and notices need it.

- [ ] Make a free account at resend.com (3,000 emails/month free), add your domain, and add the
      DNS records it shows you.
- [ ] In Railway → Variables: `EMAIL_PROVIDER=smtp`, `SMTP_URL=smtps://resend:<API key>@smtp.resend.com:465`,
      `EMAIL_FROM=DeedWood <no-reply@yourdomain.com>`.
- [ ] Test: on the sign-in page use **Forgot password?** with your email — the email should arrive.

## 2b. Sign-up protection and "Sign in with…" — you (20 minutes, all free)

New accounts always confirm a 6-digit code by email (or text). These add more:

- [ ] **"I'm human" check (Cloudflare Turnstile):** dash.cloudflare.com → Turnstile → Add widget →
      your app's domain → copy the two keys into Railway → Variables: `TURNSTILE_SITE_KEY`,
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

- [ ] DEPLOY.md step 7: `PLATFORM_OWNER_EMAIL`, run `pnpm platform:owner`, open the link, set a
      password and turn on two-factor.
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
- [ ] Stripe account (test mode first) → tell Claude; billing gets built and tested in test mode.

## 7. Practice a restore once — you + Claude (15 minutes)

You should know a restore works *before* you need it. On a copy (a second Railway environment,
or your own computer):

1. Owner console → System health → download the newest backup.
2. On the copy, with the same `BACKUP_KEY`: `pnpm db:restore --file deedwood-….dwb --yes`
3. Sign in and check a few properties and balances.

### Restore a backup (real emergency)

`pnpm db:restore --latest --yes` (Railway → service → ⋯ → Shell). It **replaces everything** with
the backup. On a computer install, close DeedWood first, open a terminal in the DeedWood folder
and run the same command.

## Already done in the code

Security headers, sign-in limits and lockout, two-factor, password reset and email
confirmation, row-level data isolation, audit logs, nightly encrypted backups (newest 14 kept),
error recording + alert emails, `/api/health`, search-engine setup, and "coming soon" for online
payments.
