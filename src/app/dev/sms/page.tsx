import { notFound, redirect } from "next/navigation";
import { adminDb } from "@/server/db";
import { receiveInboundSms } from "@/server/comms/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev SMS" };

async function simulate(form: FormData) {
  "use server";
  if (process.env.NODE_ENV === "production") return;
  await receiveInboundSms({ from: String(form.get("from") ?? ""), body: String(form.get("body") ?? ""), externalId: `SMdev${Date.now()}` });
  redirect("/dev/sms");
}

/** Development-only: texts sent by the mock SmsProvider, and a form to simulate a reply. */
export default async function DevSms() {
  if (process.env.NODE_ENV === "production") notFound();
  const msgs = await adminDb.message.findMany({ where: { channel: "SMS" }, orderBy: { createdAt: "desc" }, take: 40, include: { conversation: { select: { phone: true } } } });
  return (
    <main className="portal-density mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Dev SMS</h1>
      <p className="mt-1 text-muted-foreground">Texts sent through the mock SMS provider, newest first. Simulate a reply from a phone number below.</p>
      <form action={simulate} className="mt-4 flex flex-wrap items-end gap-2 rounded-card border border-border bg-surface p-3">
        <label className="grid gap-1 text-sm font-medium">From number<input name="from" required defaultValue={msgs.find((m) => m.direction === "OUT")?.conversation.phone ?? "+13125550142"} className="h-10 rounded-lg border border-input px-3 font-normal" /></label>
        <label className="grid flex-1 gap-1 text-sm font-medium">Reply<input name="body" required className="h-10 rounded-lg border border-input px-3 font-normal" placeholder="Thanks! / STOP" /></label>
        <button className="h-10 rounded-lg bg-primary px-4 font-medium text-primary-foreground">Simulate inbound text</button>
      </form>
      <ul className="mt-6 space-y-3">
        {msgs.map((m) => (
          <li key={m.id} className="rounded-card border border-border bg-surface p-3 text-sm" data-testid="sms-message">
            <div className="text-muted-foreground">{m.direction === "OUT" ? "→ to" : "← from"} <strong className="text-foreground">{m.conversation.phone ?? "contact"}</strong> · {m.status} · {m.segments} seg · {m.createdAt.toLocaleString()}</div>
            <p className="mt-1 whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
