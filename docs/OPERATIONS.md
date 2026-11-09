# DeedWood operations

For the person watching the hosted app (Boss) and for David when something needs a password or a click. Secret **names** are listed here. Secret **values** are not, and must not be pasted into git or chat.

## 1. Where everything lives

Cloudflare account: the same account as Oozlings. DeedWood does not have its own Cloudflare account.

| Resource | Value |
| --- | --- |
| Worker | `deedwood` |
| Marketing Pages project | `deedwood` (drag-and-drop of `deploy/pages-static`; not created by this repo's deploy workflow) |
| R2 bucket | `deedwood-uploads` |
| Workers AI binding | `AI` |
| R2 binding | `UPLOADS` (the app still uploads through the S3 adapter; the binding is there for later) |
| Hyperdrive | Not created. Optional later. See below. |
| Cron | `* * * * *` (every minute, UTC) and `15 7 * * *` (02:15 America/Kentucky/Monticello in winter EST; 03:15 during EDT) |
| Neon project | `rough-wind-47929745` |
| Neon region | US East (Ohio), `aws-us-east-2` |
| Neon database | `deedwood` (Postgres 18) |
| Neon owner role | `deedwood_owner` — migrations, row-level security, backfill, and the app's admin connection |
| Neon app role | `deedwood_app` — already created, with its own password and read/write grants. The Worker uses this role. |
| DNS zone | Not attached yet. Apex and `www` go to Pages. `app` goes to the Worker. |
| Email Routing | Not attached yet. Catch-all can POST to `/api/webhooks/email`. Resend still needs SPF and DKIM on the sending domain. |

### Database URLs (names only)

| Secret name | What to paste | Where |
| --- | --- | --- |
| `DATABASE_ADMIN_URL` | Neon **direct** connection string (host does **not** contain `-pooler`), user `deedwood_owner` | GitHub Actions secret, and a Worker secret (`wrangler secret put`) |
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`), user `deedwood_app` | GitHub Actions secret, and a Worker secret |

The Worker uses Prisma's JavaScript query compiler and the Neon driver (not the Rust database engine, which cannot run on Workers). `Prisma.dmmf` is not read at runtime on the Worker.

`deedwood_app` already exists. `prisma/rls.sql` creates that role only when it is missing, and only with the laptop password `deedwood_app`. The GitHub Action sets `DEEDWOOD_RLS_MODE=production`, which **removes** that statement before running. Any admin URL on `*.neon.tech` does the same, including if someone runs the script by hand. The Action does **not** take `APP_DB_PASSWORD` and does **not** run `ALTER ROLE`. Grants and policies are still applied. The password on `deedwood_app` stays the one already in Neon, which is the password inside `DATABASE_URL`.

Do not point `scripts/serve.mjs` (the old Railway start) at Neon. That script refuses a `*.neon.tech` host because it would replace the app role's password.

Hyperdrive is optional. If you add it later, the connection string must be the **direct** host as `deedwood_app` with the **existing** password. Do not create a new password and do not use `deedwood_owner` for Hyperdrive. Until that id is filled in, the Worker uses `DATABASE_URL` through the Neon driver.

### Worker secrets (names only)

Set with `npx wrangler secret put <NAME>` or by the deploy workflow, which copies GitHub Actions secrets of the same name. Never commit the values.

| Name | Required for a useful deploy |
| --- | --- |
| `DATABASE_ADMIN_URL` | Yes |
| `DATABASE_URL` | Yes |
| `AUTH_SECRET` | Yes (32+ random characters; changing it signs everyone out) |
| `AUTH_URL` | Yes (`https://…` of the Worker) |
| `SITE_URL` | Yes (marketing origin) |
| `S3_ENDPOINT` | Yes (`https://<account id>.r2.cloudflarestorage.com`) |
| `S3_ACCESS_KEY` | Yes (R2 token access key) |
| `S3_SECRET_KEY` | Yes (R2 token secret) |
| `RESEND_API_KEY` | Yes, to send mail |
| `EMAIL_FROM` | Yes (`DeedWood <no-reply@your-domain>`) |
| `CLOUDFLARE_ACCOUNT_ID` | For the Workers AI REST fallback |
| `CLOUDFLARE_AI_TOKEN` | Optional. The `AI` binding is preferred and needs no token. |
| `GROQ_API_KEY` | Optional fallback |
| `STRIPE_SECRET_KEY` | Test key only (`sk_test_…`) |
| `STRIPE_WEBHOOK_SECRET` | Test webhook signing secret |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Test publishable key (`pk_test_…`). Also needed at **build** time. |
| `RESEND_WEBHOOK_SECRET` | Optional, for Resend inbound (`whsec_…`) |
| `EMAIL_WEBHOOK_SECRET` | Optional, for an Email Routing forwarder |
| `BACKUP_KEY` | Optional. Without it, nightly backup files in R2 are not encrypted. |
| `PLATFORM_ALERT_EMAIL` | Optional |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Optional |

These are Worker **vars** in `wrangler.jsonc` (not secrets): `STORAGE_PROVIDER=s3`, `S3_BUCKET=deedwood-uploads`, `S3_REGION=auto`, `EMAIL_PROVIDER=resend`, `LLM_PROVIDER=cloudflare`, `LLM_FALLBACK=groq`, `SMS_PROVIDER=mock`, `AUTH_TRUST_HOST=true`, `PAYMENTS_ENABLED` empty. Leave `BILLING_ENFORCED`, `SEED_DEMO`, `ENABLE_DEV_TOOLS`, and `REDIS_URL` unset. SMS stays mock until 10DLC. Stripe stays test mode.

Non-secret build id: `DEEDWOOD_GIT_SHA` is set by GitHub Actions from the commit.

### GitHub Actions secrets (Settings → Secrets and variables → Actions)

Same names as the Worker secrets above, plus:

| Name | Used for |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | `wrangler deploy` (account token, not the narrower Boss token) |
| `CLOUDFLARE_ACCOUNT_ID` | Wrangler account |

`DATABASE_ADMIN_URL` is the only database secret the migrate job reads. It does not read `APP_DB_PASSWORD`. There is no `APP_DB_PASSWORD` secret on purpose.

The workflow `.github/workflows/deploy-cloudflare.yml` is **workflow_dispatch** only until these secrets exist, so a normal push does not fail. After they are set, a `push` to `main` can be turned on in that file.

## 2. Health

`GET /api/health` returns:

```json
{ "ok": true, "db": "ok", "storage": "ok", "ai": "ok", "email": "ok", "payments": "off", "version": "<git sha>" }
```

`db` is one `SELECT 1` on the admin connection. `storage` lists at most one R2 object (it does not upload). `ai` is "ok" when the Workers AI binding or a configured key is present, "off" when AI is the built-in helper, "down" when a provider is selected but has no credentials. It does not call a model. `email` is "ok" only when Resend's key and from-address are both set; it does not send. `payments` stays "off" until `PAYMENTS_ENABLED=1`. The body never includes connection strings, tokens, or key fragments.

Poll `/api/health`. Tell David only if `ok` is false for more than two checks in a row.

## 3. Logs

- Live: `npx wrangler tail deedwood`
- Dashboard → Workers & Pages → deedwood → Observability (Workers Logs, free tier)
- Cron history: Worker → Settings → Triggers → Cron Events
- Neon console → project `rough-wind-47929745` → Queries / Monitoring. The free compute suspends after idle; the first query after that is slow and that is expected.

## 4. Deploy and rollback

Normal deploy, after secrets exist: GitHub → Actions → **Deploy to Cloudflare** → Run workflow. Order is fixed: `prisma migrate deploy`, then `prisma/apply-rls.ts`, then `prisma/backfill.ts`, then `opennextjs-cloudflare build`, then `wrangler deploy`. The Worker does not migrate on boot.

From a machine that already has the API token in the environment: `pnpm deploy:cf`.

Rollback a bad Worker build: `npx wrangler rollback`. Or re-run an older successful Actions deploy. During the move off Railway, point DNS back to Railway if the Worker itself is not the problem. Keep Railway running until David says the smoke tests passed.

Migrations only move forward. If migrate fails, fix the migration and run the workflow again. Do not skip a failed migration.

## 5. Rotating secrets

`npx wrangler secret put <NAME>`, then confirm `/api/health`, then revoke the old value in Neon, R2, Resend, or Stripe. Update the GitHub Actions secret of the same name so the next deploy does not put the old value back.

Order: create the new value, put the secret, check health, revoke the old value. Changing `AUTH_SECRET` signs everyone out. Rotating `DATABASE_URL` means changing the `deedwood_app` password in Neon **and** updating the secret. Do that by hand in the Neon console. Do not do it by running `apply-rls` or `serve.mjs`.

David pastes new values into the dashboard or into `wrangler secret put`. Do not put them in chat.

## 6. Neon backups and restore

Neon Free history (checked against Neon’s plan page, November 2026): **6 hours**, and at most **1 GB** of change history, on the root branch. That is the point-in-time window. It is short. Do not upgrade the Neon plan unless David says so.

The app also writes a nightly JSON snapshot to R2 at `backups/…dwb` (encrypted when `BACKUP_KEY` is set). Fourteen successful snapshots are kept.

Restore drill:

1. In Neon, branch from `rough-wind-47929745` at a time inside the history window. Point a **preview** Worker at that branch’s URLs. Do not point production `DATABASE_URL` at a branch until you mean to.
2. Or, on a computer that is not the Worker: download a `.dwb` from the owner console and run `pnpm db:restore --file <file> --yes` with the same `BACKUP_KEY`. Restore replaces the database it is pointed at.

`deedwood_app` on a new branch still has whatever password the branch inherited. Do not “fix” it with the local password.

## 7. Limits (stay near $5 plus free tiers)

| Limit | What to watch |
| --- | --- |
| Workers Paid | $5 includes 10 million requests/month. One landlord is inside that. Look if requests jump. |
| Workers AI free | 10,000 neurons/day. The app caps calls (`LLM_DAILY_LIMIT`) and falls back to Groq, then the built-in helper. Watch for 429s in the logs. |
| R2 free | 10 GB. Say something near 8 GB. |
| Neon free | 1 GB stored per project. Compute suspends after idle. Say something as it nears 1 GB. |
| Resend free | About 100 emails/day and 3,000/month (confirm the live number in the Resend dashboard; free caps change). Say something near 80 in a day. |
| Hyperdrive | Included with Workers Paid. Not turned on yet. |
| Queues | Not turned on. |
| Twilio | $0 while SMS is mock. |

Do not upgrade Neon, Resend, or R2, and do not turn on extra Workers spend, unless David says yes.

## 8. API token for Boss

Create a **custom** token that is narrower than the deploy token. David pastes it into Boss’s own secret store, not into git.

Account (this Cloudflare account only):

- Workers Scripts: **Edit**
- Workers AI: **Read**
- Account Analytics: **Read**
- Workers R2 Storage: **Edit**

Zone (the DeedWood domain only, once the domain is on Cloudflare):

- Zone: **Read**
- DNS: **Edit**
- Email Routing Addresses: **Edit**
- Email Routing Rules: **Edit**

Do not include billing, user management, creating API tokens, every zone, or Workers KV (KV is not used).

Boss does not change billing, does not touch unrelated zones, and does not copy secret values into chat. If a secret has to change, David pastes it into the dashboard or into `wrangler secret put`.

## 9. When something breaks

| What you see | What to check |
| --- | --- |
| Site down | `/api/health`, `npx wrangler tail deedwood`, Cloudflare status, Neon status. Roll the Worker back if a deploy just went out. |
| Mail not sending | Resend dashboard, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM` present, domain SPF/DKIM. |
| AI empty | Workers AI daily neurons, then Groq, then `LLM_PROVIDER`. The product falls back to the built-in helper instead of showing a raw error. |
| Uploads failing | R2 token, bucket `deedwood-uploads`, `STORAGE_PROVIDER=s3`, `S3_ENDPOINT` is the account’s `r2.cloudflarestorage.com` host. |
| Nightly missed | Cron Events for `15 7 * * *`. Then the in-app “Run nightly now” button. `JobRun` in the database is the stamp (there is no disk file on Workers). |
| Tenants see each other’s data | You are not connected as `deedwood_app`, or row-level security was not re-applied. Re-run the deploy workflow. Do not switch the Worker to `deedwood_owner`. |

## 10. Still manual

- R2 bucket `deedwood-uploads` and its API token
- Workers Paid ($5) turned on
- Resend domain and API key
- GitHub Actions secrets and the first **workflow_dispatch** deploy
- Custom domain and Email Routing
- Railway stays up until David confirms smoke tests, then David cancels it
