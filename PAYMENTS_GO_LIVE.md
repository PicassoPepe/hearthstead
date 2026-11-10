# Turning payments on

Payments stay **off** until you say go. Nothing in this checklist flips a switch by itself.
`PAYMENTS_ENABLED` and `BILLING_ENFORCED` stay unset (treated as off). Do not put live Stripe
keys in production until you have finished a test-mode pass.

There are two separate Stripe uses:

1. **DeedWood's own subscription** (companies paying DeedWood). Checkout, the customer portal, and
   `/api/webhooks/stripe`.
2. **Tenant rent** (Stripe Connect Express). A landlord connects a bank account; residents pay by
   card or ACH; the convenience fee is an application fee on the connected account.

Wendy's company is **BETA**. A free beta or complimentary company is not billed, and a Stripe
webhook cannot flip it to active, past due, or canceled. Checkout from that company is refused
with "This company is on a free plan." Ending the free plan is a separate owner-console action.

## What is already in the code

- Flag: online rent moves only when `PAYMENTS_ENABLED=1` **and** `PAYMENTS_PROVIDER=stripe`
  (or a non-production demo with `ENABLE_DEV_TOOLS=1`). Cash, check, and money order recorded by
  staff always work.
- Billing lockout happens only when `BILLING_ENFORCED=1` and the deployment is not the Windows
  local app. Unpaid companies go read-only after the grace period. Data is not deleted.
- SaaS checkout looks up prices by these keys (they must be active in Stripe):

  | Plan | Lookup key |
  | --- | --- |
  | Starter monthly | `starter_monthly` |
  | Starter yearly | `starter_yearly` |
  | Growth (monthly only) | `growth_unit_monthly` |
  | Scale monthly | `scale_unit_monthly_tiered` |
  | Scale yearly | `scale_unit_yearly_tiered` |
  | Local annual | `local_unit_yearly` |
  | Local care add-on | `local_care_yearly` |

- The billing webhook checks the Stripe signature and stores the event id. A second delivery of
  the same id is ignored.
- Card rent that Stripe confirms immediately is posted to the ledger. ACH is posted while it is
  still processing. The convenience fee never hits the resident ledger.
- Connect onboarding returns to `/app/settings/payments`.

## Secrets (names only — values stay in Cloudflare and GitHub)

Set these as Worker secrets (and the publishable key also as a GitHub Actions secret, because the
Workers build bakes it in):

| Name | Value |
| --- | --- |
| `STRIPE_SECRET_KEY` | `sk_test_…` until you approve live, then `sk_live_…` |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the endpoint below (`whsec_…`) |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_test_…` matching the secret key, then `pk_live_…` |
| `PAYMENTS_ENABLED` | `1` only when tenant rent should move |
| `PAYMENTS_PROVIDER` | `stripe` |
| `BILLING_ENFORCED` | `1` only when unpaid companies should become read-only |
| `STRIPE_LIVE_APPROVED` | `1` only together with live keys. The server refuses `sk_live_` without it |
| `STRIPE_TAX` | `1` only if you turn on Stripe Tax |

Do not create an `APP_DB_PASSWORD` secret. Database passwords stay in `DATABASE_URL` and
`DATABASE_ADMIN_URL`.

## Stripe dashboard

1. Stay in **test mode** for the first pass.
2. Developers → Webhooks → Add endpoint
   **`https://deedwood.com/api/webhooks/stripe`**
3. Subscribe that endpoint to the billing events the app handles:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `customer.subscription.paused`
   - `customer.subscription.resumed`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Settings → Billing → Customer portal: let customers update a card and cancel.
6. Connect → Express: the platform secret key is what the app uses to create accounts. Card
   payments, ACH (`us_bank_account_ach_payments`), and transfers must be requested (the code
   already requests them on each new account).
7. Confirm the lookup keys above exist and are active. Growth has no yearly price.
8. Promo code `DEEDWOODBETA` can stay for companies that are **not** already marked free.
   Do not send Wendy (or any other BETA company) through Checkout.

`AUTH_URL` must be `https://deedwood.com` so Connect return links and sign-in cookies match
the site people use.

## Switch-on order

1. Deploy the reviewed build with payments still off. Confirm `/api/health` is ok.
2. Add the test-mode keys and the webhook secret. Leave `PAYMENTS_ENABLED` and
   `BILLING_ENFORCED` unset. Restart is a new Worker deploy of the same code with the new secrets.
3. On a **throwaway** company (not Wendy): Settings → Billing → start Checkout with a Stripe test
   card `4242…`. Confirm the subscription becomes active and a second webhook delivery does not
   double-apply. Confirm Wendy's company stays BETA with no Stripe customer required.
4. On the throwaway company: Settings → Payments → connect a Stripe Express **test** account.
   Pay a test rent by card from the resident portal. Confirm the ledger payment and the
   application fee. Pay a test ACH and see it sit in Processing (see the blocker below).
5. Only after that: set `PAYMENTS_ENABLED=1` and `PAYMENTS_PROVIDER=stripe` if you want resident
   rent to move for every company that has finished Connect.
6. Set `BILLING_ENFORCED=1` only when you want unpaid companies locked to read-only. Free beta
   and complimentary companies stay usable.
7. Live keys are a later decision: `sk_live_` / `pk_live_`, a **new** live webhook secret, and
   `STRIPE_LIVE_APPROVED=1` together. Test and live keys must match each other.

## Risks still open

These are why tenant rent is **not** ready to switch on, even though SaaS billing for a
non-beta company is close.

1. **No Connect webhook.** `/api/webhooks/stripe` only updates DeedWood subscriptions. It does
   not handle `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`,
   `charge.dispute.created`, `payout.paid`, or `account.updated`. ACH rent is stored as
   Processing and is only advanced by the mock processor's "Simulate: clears" button. A real
   ACH payment would stay Processing, and a later bank return would not reverse the ledger.
   Pointing Connect events at the billing endpoint marks them as already handled and then
   ignores them. Do not do that. Tenant rent needs its own signed, idempotent handler before
   `PAYMENTS_ENABLED=1`.
2. **Card refunds and disputes are manual.** Staff can record a deposit or credit refund in the
   ledger. Stripe does not push those back into DeedWood, and DeedWood does not call Stripe to
   refund a PaymentIntent.
3. **Connect account status is refreshed when someone opens payment settings**, not when Stripe
   restricts the account. A landlord can be restricted and the portal can still offer pay until
   the next refresh.
4. **Receipts** for online rent are the ledger payment and the resident history. There is no
   separate emailed Stripe receipt wired up.
5. **One webhook secret** is shared. Billing and a future Connect endpoint should use different
   signing secrets so a test event cannot be mistaken for the other product.
6. The app database role can still **read the User table** (including password hashes). Sign-in
   and name lookups use that table. It is not tenant-scoped. Login session rows (`UserSession`)
   are now revoked from that role; only the admin connection writes them.

## What stays safe if you only turn billing enforcement on

`BILLING_ENFORCED=1` without `PAYMENTS_ENABLED` does not start resident card or ACH charges.
BETA and complimentary companies are not locked and are not sent to Checkout. Trial companies
whose trial has ended, and paid companies that go past due past the grace window, become
read-only. Wendy's org must stay BETA.
