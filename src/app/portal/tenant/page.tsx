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

export const metadata = { title: "Home" };

export default async function PortalHome() {
  const ctx = await requirePortal();
  const [h, news, unread] = await Promise.all([portalHome(ctx), portalAnnouncements(ctx.db, { tenantId: ctx.tenant.id }, 3), unreadPortalCount(ctx.db, { tenantId: ctx.tenant.id })]);
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
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Hi, {first}</h1>

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
          <p className="mt-4 rounded-lg bg-surface-muted p-3 text-sm text-muted-foreground">Online payments aren&apos;t available yet. Contact {ctx.org.name} for other ways to pay.</p>
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

      {unread ? (
        <Card className="flex items-center justify-between gap-3 border-primary/40 p-4">
          <span className="text-sm"><span className="font-semibold">{unread} new message{unread === 1 ? "" : "s"}</span> from {ctx.org.name}</span>
          <Button asChild size="sm"><Link href="/portal/tenant/messages">Read</Link></Button>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Wrench className="size-4" aria-hidden /> Maintenance</h2>
          <p className="mt-1 text-sm text-muted-foreground">{h.settings.allowRequests ? "No open requests." : "Contact the office for repairs."}</p>
          {h.settings.allowRequests ? <Link href="/portal/tenant/requests" className="mt-2 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">Request a repair</Link> : null}
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
