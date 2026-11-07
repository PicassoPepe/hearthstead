import Link from "next/link";
import { Megaphone } from "lucide-react";
import { requireOwnerPortal } from "@/server/portal/owner-context";
import { ownerHome } from "@/server/portal/owner-queries";
import { portalAnnouncements } from "@/server/comms/announcements";
import { unreadPortalCount } from "@/server/comms/portal-queries";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export const metadata = { title: "Home" };

export default async function OwnerHome() {
  const o = await requireOwnerPortal();
  const [h, news, unread] = await Promise.all([ownerHome(o), portalAnnouncements(o.db, { ownerId: o.owner.id }, 3), unreadPortalCount(o.db, { ownerId: o.owner.id })]);
  const first = o.owner.name.split(" ")[0];
  const max = Math.max(1, ...h.trend.flatMap((t) => [t.income, t.expenses]));
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Hi, {first}</h1>
      <p className="-mt-2 text-sm text-muted-foreground">Year to date across your {o.properties.length} propert{o.properties.length === 1 ? "y" : "ies"} — your ownership share.</p>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[["Income", h.income], ["Expenses", h.expenses], ["Net income", h.net], ["Distributed to you", h.distributed]].map(([l, v]) => (
          <Card key={l as string} className="p-4"><dt className="text-sm text-muted-foreground">{l}</dt><dd className="mt-1 text-2xl font-semibold tabular" data-testid={`owner-${String(l).toLowerCase().replace(/ /g, "-")}`}>{formatMoney(v as number, { showCents: false })}</dd></Card>
        ))}
      </dl>
      {unread ? (
        <Card className="flex items-center justify-between gap-3 border-primary/40 p-4">
          <span className="text-sm"><span className="font-semibold">{unread} new message{unread === 1 ? "" : "s"}</span> from {o.org.name}</span>
          <Button asChild size="sm"><Link href="/portal/owner/messages">Read</Link></Button>
        </Card>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Card className="p-4">
          <h2 className="font-semibold">Last 6 months</h2>
          <ul className="mt-2 flex gap-3 text-xs" aria-hidden><li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-1" /> Income</li><li className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-chart-2" /> Expenses</li></ul>
          <div className="mt-2 flex h-28 items-end gap-2" aria-hidden>
            {h.trend.map((t) => (
              <div key={t.month} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-24 w-full items-end justify-center gap-0.5">
                  <div className="w-1/3 rounded-t bg-chart-1" style={{ height: `${(t.income / max) * 100}%` }} title={`Income ${formatMoney(t.income)}`} />
                  <div className="w-1/3 rounded-t bg-chart-2" style={{ height: `${(t.expenses / max) * 100}%` }} title={`Expenses ${formatMoney(t.expenses)}`} />
                </div>
                <span className="text-[10px] text-muted-foreground">{new Date(`${t.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span>
              </div>
            ))}
          </div>
          <table className="sr-only"><caption>Your income and expenses by month</caption><thead><tr><th scope="col">Month</th><th scope="col">Income</th><th scope="col">Expenses</th></tr></thead><tbody>{h.trend.map((t) => <tr key={t.month}><th scope="row">{t.month}</th><td>{formatMoney(t.income)}</td><td>{formatMoney(t.expenses)}</td></tr>)}</tbody></table>
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">Occupancy</h2>
          <p className="mt-1 text-3xl font-semibold tabular">{h.units ? Math.round((h.occupied / h.units) * 100) : 0}%</p>
          <p className="text-sm text-muted-foreground">{h.occupied} of {h.units} units occupied</p>
          {h.vacant.length ? <ul className="mt-2 grid gap-1 text-sm">{h.vacant.slice(0, 5).map((v) => <li key={v.id} className="flex justify-between"><span>{v.property} · {v.name}</span><span className="text-muted-foreground">{formatMoney(v.marketRentCents, { showCents: false })}/mo</span></li>)}</ul> : <p className="mt-2 text-sm text-success">No vacancies.</p>}
        </Card>
        <Card className="p-4">
          <h2 className="font-semibold">Recent distributions</h2>
          <ul className="mt-2 grid gap-1 text-sm">
            {h.recentDistributions.map((d) => <li key={d.id} className="flex justify-between"><span>{formatDate(d.date)} · {d.property}</span><span className="tabular">{d.kind === "CONTRIBUTION" ? "+" : ""}{formatMoney(d.amountCents)}</span></li>)}
            {!h.recentDistributions.length ? <li className="text-muted-foreground">None yet.</li> : null}
          </ul>
          <Link href="/portal/owner/payments" className="mt-2 inline-block text-sm font-medium text-primary hover:underline">All distributions</Link>
        </Card>
        <Card className="p-4">
          <h2 className="flex items-center gap-2 font-semibold"><Megaphone className="size-4" aria-hidden /> Announcements</h2>
          {news.length ? <ul className="mt-2 grid gap-2 text-sm">{news.map((n) => <li key={n.id}><div className="font-medium">{n.title}</div><p className="text-muted-foreground">{n.body}</p></li>)}</ul> : <p className="mt-1 text-sm text-muted-foreground">No announcements right now.</p>}
        </Card>
      </div>
    </div>
  );
}
