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

## 3. The app

Follow [DEPLOY.md](./DEPLOY.md) (Railway, about 15 minutes) and point `app.deedwood.com` at it.
Set `SITE_URL=https://deedwood.com` there too, so links and Google tags agree.

### Why the app isn't on Cloudflare too (yet)

Cloudflare's free servers (Workers) don't run normal Node.js programs. Moving the app there
would mean changing how it stores files, talks to the database (Prisma driver adapters through
Hyperdrive/Neon), runs nightly jobs and limits sign-ins (no Redis). That's a sizeable rewrite
with real risk, so the plan is: marketing on Cloudflare now, app on Railway, and revisit
Workers (OpenNext) later if it's worth it.

## Settings for the app (Railway → Variables)

| Name | What |
| --- | --- |
| `SITE_URL` | Your marketing address, e.g. `https://deedwood.com` |
| `CONTACT_EMAIL` | Shown on About/Privacy (leave empty to hide) |
| `PAYMENTS_ENABLED` | Leave **unset** until you're ready for online payments ("coming soon" everywhere until then). Set to `1` to turn them on. |
