# Put DeedWood online

Run DeedWood on the internet so you, your team, tenants and owners can open it from any device —
no install on anyone's computer. This guide uses **Railway** (simple, about US$5/month after the
free trial). DeedWood also runs on any host that can run a Docker image (Render, Fly.io, a VPS).

You'll need: a GitHub account (you have one) and about 15 minutes.

## 1. Create the project

1. Go to **railway.com** and choose **Login → GitHub**.
2. Click **New Project → Deploy from GitHub repo** and pick **PicassoPepe/hearthstead**
   (allow Railway to see the repository if it asks).
3. Railway starts building straight away. It will fail the first time because the settings below
   aren't there yet. That's expected.

## 2. Add a database

In the project, click **+ New → Database → Add PostgreSQL**. Wait until it shows as running.

## 3. Give the app a web address

Click the **hearthstead** service (the app, not the database) → **Settings → Networking →
Generate Domain**. Copy the address it shows, e.g. `https://hearthstead-production.up.railway.app`.

## 4. Add the settings

Still on the app service, open **Variables** and add these (**+ New Variable** for each):

| Name | Value |
| --- | --- |
| `DATABASE_ADMIN_URL` | `${{Postgres.DATABASE_URL}}` (type it exactly like this — Railway fills in the real address) |
| `AUTH_SECRET` | A long random password, at least 32 characters. A password manager's generator is perfect. **Keep it the same forever** — changing it signs everyone out. |
| `AUTH_URL` | The address from step 3, starting with `https://` |
| `SEED_DEMO` | `1` if you want the demo company to explore first; leave it out for a clean start |

Optional, so DeedWood can really send emails (sign-in links, invites, reminders, statements):

| Name | Value |
| --- | --- |
| `EMAIL_PROVIDER` | `smtp` |
| `SMTP_URL` | From your email service, e.g. `smtps://USER:PASSWORD@smtp.resend.com:465` |
| `EMAIL_FROM` | `Your Company <no-reply@yourdomain.com>` |

Without email set up, everything still works with email + password sign-in; emails just aren't
delivered.

Optional, for land records (parcel maps and owner of record) outside Louisville/Jefferson County:

| Name | Value |
| --- | --- |
| `REGRID_TOKEN` | Your Regrid API token (regrid.com/api — paid, per parcel; each property is looked up once and refreshed every 90 days) |
| `PLATFORM_OWNER_EMAIL` | Your email — used once by `pnpm platform:owner` to create the owner-console login |
| `GOOGLE_MAPS_API_KEY` | Optional. Google Street View pictures of each property (Street View Static API key). Aerial photos are free and need nothing. |

## 5. Keep uploaded files

Photos, logos and documents need a place that survives updates: **Settings → Volumes → Add
Volume**, mount path **`/data`**.

## 6. Deploy

Click **Deploy** (or **Redeploy**). The first build takes a few minutes. When it's green, open your
address:

- With `SEED_DEMO=1`: sign in as `admin@example.com` / `Demo1234!x`, then change that password
  (Settings → Account & security) or sign up your real company.
- Without demo data: click **Sign up** to create your company — the setup guide walks you through
  the rest.

## 7. Set up the owner console (DeedWood's own control panel)

The owner console at `/admin` manages every company on the server: pause or turn on a company,
sign people out, reset someone's two-factor, "view as" a member to help them (time-limited, with a
reason, fully logged), feature switches, announcements, releases and system health.

1. In Railway → Variables add `PLATFORM_OWNER_EMAIL` = your email, and redeploy.
2. Railway → your service → **⋯ → Shell**, run `pnpm platform:owner`. It prints a one-time sign-in
   link (30 minutes).
3. Open the link, choose a password, turn on two-factor authentication, sign out and back in, and
   open `/admin`.

Optional: `PLATFORM_ADMIN_IP_ALLOWLIST` (comma-separated addresses allowed into `/admin`) and
`PLATFORM_BREAK_GLASS_SECRET` (24+ random characters, needed only to hand ownership to another
email: `pnpm platform:owner --rotate --secret=…`). Company admins can never reach `/admin`.

## Updates

Every time new code lands on GitHub, Railway rebuilds and redeploys automatically. Your data stays
in the database and the `/data` volume.

## Good to know

- **Background jobs** (rent posting, late fees, reminders, autopay, owner statements, scheduled
  announcements) run inside the app — nothing else to set up.
- **Security:** the app connects to the database through its own restricted login (row-level
  security), with a private password derived from `AUTH_SECRET`. Turn on two-factor
  authentication for every staff account.
- **Payments, texting, AI:** they run in demo mode until you add the provider keys (see the
  "Adapters" section of the README).
- **Never** set `ENABLE_DEV_TOOLS` on an online install.
- **Settings check:** on every start the server runs `scripts/check-env.mjs` and refuses to start if
  `AUTH_SECRET` is short or a placeholder, `AUTH_URL` isn't `https://…`, a provider key is a
  placeholder, or a live Stripe key is set before going live is approved (`STRIPE_LIVE_APPROVED=1`).
  Run it yourself any time with `pnpm check-env`.
- **Secrets live only in the host's settings** (Railway → Variables): `AUTH_SECRET`, `DATABASE_*`,
  `STRIPE_*`, `TWILIO_*`, `S3_*`, `ANTHROPIC_API_KEY`, `REGRID_TOKEN`, `GOOGLE_MAPS_API_KEY`. Never put
  them in GitHub.
- **Built-in protections:** security headers (no framing, content security policy, HTTPS-only
  cookies when the address is https), sign-in limits (an account locks for 15 minutes after 8 wrong
  passwords or codes; per-address limits on sign-in, sign-up and email links), and a security log of
  failed sign-ins that stores a fingerprint of the email, never the email itself. Add `REDIS_URL`
  if you run more than one server so the limits are shared.
