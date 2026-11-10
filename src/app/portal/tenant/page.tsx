import Link from "next/link";
import { CalendarClock, CheckCircle2, CreditCard, Megaphone, Repeat, Wrench } from "lucide-react";
import { requirePortal } from "@/server/portal/context";
import { portalHome } from "@/server/portal/queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { portalAnnouncements } from "@/server/comms/announcements";
import { unreadPortalCount } from "@/server/comms/portal-queries";
import { openSignatureFromPortal } from "@/server/actions/portal";
import { WelcomeSteps } from "@/components/onboarding/welcome-steps";

export default async function PortalHome() {
  const ctx = await requirePortal();
  const [h, news, unread, toSign] = await Promise.all([
    portalHome(ctx), portalAnnouncements(ctx.db, { tenantId: ctx.tenant.id }, 3), unreadPortalCount(ctx.db, { tenantId: ctx.tenant.id }),
    ctx.tenant.email ? ctx.db.signatureRequest.findMany({ where: { status: "SENT", leaseId: { in: ctx.leases.map((l) => l.id) }, signers: { some: { email: ctx.tenant.email.toLowerCase(), status: { in: ["PENDING", "VIEWED"] } } } }, select: { id: true, title: true } }) : Promise.resolve([]),
  ]);
  const first = ctx.tenant.name.split(" ")[0];
  if (!h) {
    return (
      <Card className="p-6 text-center">
        <h1 className="text-xl font-semibold">Welcome, {first}</h1>
        <p className="mt-2 text-muted-foreground">Your lease isn&apos;t active in the portal yet. Contact {ctx.org.name} if you think this is a mistake.</p>
      </Card>
    );
  }
  const owes = h.balanceCents > 0;
  const [insured, requests] = await Promise.all([
    ctx.lease ? ctx.db.insurancePolicy.count({ where: { leaseId: ctx.lease.id } }) : Promise.resolve(0),
    ctx.db.task.count({ where: { tenantId: ctx.tenant.id, type: "TENANT_REQUEST" } }),
  ]);
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Hi, {first}</h1>
      <WelcomeSteps
        storageKey={`dw-welcome-tenant-${ctx.tenant.id}`}
        title={`Welcome to ${ctx.org.name}'s resident portal`}
        intro="A few things to set up so paying rent and getting help is effortless."
        steps={[
          { id: "method", label: "Add a payment method", description: "Bank account (ACH) or card.", href: "/portal/tenant/methods", done: h.methods.length > 0 },
          { id: "autopay", label: "Turn on autopay", description: "Rent pays itself on the day you choose.", href: "/portal/tenant/autopay", done: Boolean(h.autopay) },
          { id: "insurance", label: "Add renters insurance", description: "Upload your policy or get covered.", href: "/portal/tenant/insurance", done: insured > 0 },
          { id: "request", label: "Know how to get help", description: "Submit maintenance requests with photos, 24/7.", href: "/portal/tenant/requests", done: requests > 0 },
        ]}
      />

      <Card className="p-5">
        <div className="text-sm text-muted-foreground">{h.balanceCents < 0 ? "Credit balance" : "Balance due"}</div>
        <div className="mt-1 text-4xl font-semibold tabular tracking-tight" data-testid="portal-balance">{formatMoney(Math.abs(h.balanceCents))}</div>
        {owes ? null : <p className="mt-1 flex items-center gap-1.5 text-sm text-success"><CheckCircle2 className="size-4" aria-hidden /> You&apos;re all paid up</p>}
        {h.nextDue ? <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"><CalendarClock className="size-4" aria-hidden /> Next rent of {formatMoney(h.rentCents)} is due {formatDate(h.nextDue)}</p> : null}
        {h.paymentsReady ? (
          <Button asChild size="lg" className="mt-4 w-full sm:w-auto">
            <Link href="/portal/tenant/pay"><CreditCard aria-hidden /> {owes ? "Pay now" : "Make a payment"}</Link>
          </Button>
        ) : (
          <p className="mt-4 rounded-lg bg-surface-muted p-3 text-sm text-muted-foreground">{h.paymentsComingSoon ? "Online payments are coming soon." : "Online payments aren’t available yet."} Contact {ctx.org.name} for other ways to pay.</p>
        )}
      </Card>

      <Card className="flex items-center gap-3 p-4">
        <Repeat className="size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1 text-sm">
          <div className="font-medium">Autopay {h.autopay ? "is on" : "is off"}</div>
          <div className="text-muted-foreground">
            {h.autopay ? `${h.autopay.amountMode === "FIXED" ? formatMoney(h.autopay.fixedCents ?? 0) : "Full balance"} on day ${h.autopay.dayOfMonth} from ${h.autopay.method}` : "Never miss a due date."}
          </div>
        </div>
        <Button asChild variant="secondary" size="sm"><Link href="/portal/tenant/autopay">{h.autopay ? "Manage" : "Set up"}</Link></Button>
      </Card>

      {h.recentPayments.length ? (
        <section aria-labelledby="recent-h">
          <h2 id="recent-h" className="mb-2 font-semibold">Recent payments</h2>
          <Card className="divide-y divide-border">
            {h.recentPayments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                <span>{formatDate(p.date)} · {p.methodType === "CARD" ? "Card" : "Bank"}{p.origin === "AUTOPAY" ? " · Autopay" : ""}</span>
                <span className="flex items-center gap-2"><StatusBadge status={p.status} /> <span className="tabular font-medium">{formatMoney(p.amountCents)}</span></span>
              </div>
            ))}
          </Card>
        </section>
      ) : null}

      {toSign.map((r) => (
        <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-primary/40 p-4">
          <span className="text-sm"><span className="font-semibold">Ready to sign:</span> {r.title}</span>
          <form action={openSignatureFromPortal.bind(null, r.id)}><Button size="sm" type="submit" disabled={ctx.preview}>Review &amp; sign</Button></form>
        </Card>
      ))}

      {unread ? (
        <Card className="flex items-center justify-between gap-3 border-primary/40 p-4">
          <span className="text-sm"><span className="font-semibold">{unread} new message{unread === 1 ? "" : "s"}</span> from {ctx.org.name}</span>
          <Button asChild size="sm"><Link href="/portal/tenant/messages">Read</Link></Button>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Wrench className="size-4" aria-hidden /> Something broken?</h2>
          {h.settings.allowRequests ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">Tell us what&apos;s wrong and add photos.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="lg"><Link href="/portal/tenant/requests/new"><Wrench aria-hidden /> Report a repair</Link></Button>
                <Button asChild variant="ghost"><Link href="/portal/tenant/requests">My repairs</Link></Button>
              </div>
            </>
          ) : <p className="mt-1 text-sm text-muted-foreground">Call the office for repairs.</p>}
        </Card>
        <Card className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Megaphone className="size-4" aria-hidden /> Announcements</h2>
          {news.length ? (
            <ul className="mt-2 grid gap-2 text-sm">
              {news.map((n) => <li key={n.id}><div className="font-medium">{n.title}</div><p className="text-muted-foreground">{n.body}</p><p className="text-xs text-muted-foreground">{formatDate(n.sentAt)}</p></li>)}
            </ul>
          ) : <p className="mt-1 text-sm text-muted-foreground">No announcements right now.</p>}
        </Card>
      </div>
    </div>
  );
}
