# Putting DeedWood on Cloudflare (free)

DeedWood has two parts:

| Part | What it is | Where it goes |
| --- | --- | --- |
| **Marketing website** | deedwood.com — home, features, pricing, security, about, terms, privacy | **Cloudflare Pages** (drag and drop a folder, free) |
| **The app** | sign-in, staff app, tenant/owner portals, company websites, database | A server that runs Node.js + Postgres — see [DEPLOY.md](./DEPLOY.md) (Railway) |

## 1. Make the marketing folder (on your Windows computer)

1. Double-click **Make Website Folder.bat** in the DeedWood folder.
2. Type your website address (e.g. `https://deedwood.com`) and your app address
   (e.g. `https://app.deedwood.com`) when it asks.
3. When it says **Done**, the folder is on your Desktop: `DeedWood\deploy\pages-static`.

(Developers: `node scripts/export-marketing.mjs --out deploy/pages-static --site https://… --app https://…`.)

## 2. Upload it to Cloudflare Pages

1. Sign in at dash.cloudflare.com → **Workers & Pages** → **Create** → **Pages** → **Upload assets**.
2. Name the project (e.g. `deedwood`) and **drag the `pages-static` folder** in. Press **Deploy**.
3. **Custom domains** → add `deedwood.com` (and `www.deedwood.com`). Cloudflare sets up HTTPS.

The folder already contains `robots.txt`, `sitemap.xml`, security headers (`_headers`) and
redirects (`_redirects`) that send `/login`, `/signup`, `/app/…` and `/portal/…` to the app.
Whenever prices or pages change, make the folder again and upload it again (Cloudflare keeps the
old versions so you can roll back).

## 3. The app (Cloudflare Workers)

The signed-in app is a Worker named `deedwood`, built with OpenNext. It is not a folder you drag
in. Database, file storage, and the background jobs:

| Piece | What |
| --- | --- |
| Database | Neon project `rough-wind-47929745` (US East Ohio, database `deedwood`). `DATABASE_ADMIN_URL` is the direct host as `deedwood_owner`. `DATABASE_URL` is the pooled `-pooler` host as `deedwood_app`. |
| Files | R2 bucket `deedwood-uploads`, through the app's existing S3 adapter |
| Mail | Resend over HTTPS (`EMAIL_PROVIDER=resend`). SMTP is only for a local Mailpit. |
| Jobs | Cron `* * * * *` and `15 7 * * *` UTC. No Redis. |
| AI | Workers AI binding, Groq if that is out of quota |

Deploy is GitHub → Actions → **Deploy to Cloudflare** (run it by hand until the secrets in
[OPERATIONS.md](./OPERATIONS.md) are saved). That workflow migrates, applies row-level security
**without** creating or resetting `deedwood_app`, then deploys the Worker.

`scripts/serve.mjs` is the old Railway start. It will not run against Neon.

DNS, once you have a domain on Cloudflare:

| Name | Points at |
| --- | --- |
| `deedwood.com`, `www` | the Pages project |
| `app` | the Worker `deedwood` (Workers & Pages → deedwood → Settings → Domains) |

Set `AUTH_URL` to the app origin (`https://app.deedwood.com` or the `*.workers.dev` host) and
`SITE_URL` to the marketing origin. Stripe's test webhook, when you add it, is
`https://<app host>/api/webhooks/stripe`.

Computer installs are unchanged: **Update DeedWood.bat** still downloads `main`, and
**Start DeedWood.bat** still uses the local database.

## Settings for the app

Every secret name, and where to paste it, is in [OPERATIONS.md](./OPERATIONS.md). In short:
GitHub Actions secrets and Worker secrets use the same names. `DATABASE_ADMIN_URL` and
`DATABASE_URL` are the two database secrets. There is no `APP_DB_PASSWORD` secret.

| Name | What |
| --- | --- |
| `SITE_URL` | Marketing address, e.g. `https://deedwood.com` |
| `AUTH_URL` | App address, e.g. `https://app.deedwood.com` |
| `PAYMENTS_ENABLED` | Leave **unset**. Online rent payments stay "coming soon". |
| `BILLING_ENFORCED` | Leave **unset** for the beta. |
| `SMS_PROVIDER` | Stays `mock` until 10DLC is registered. |
