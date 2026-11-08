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
