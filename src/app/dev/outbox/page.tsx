import { devToolsEnabled } from "@/lib/dev-tools";
import { notFound } from "next/navigation";
import { adminDb } from "@/server/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dev outbox" };

/** Development-only view of emails captured by the MockEmailProvider. */
export default async function Outbox() {
  if (!devToolsEnabled()) notFound();
  const messages = await adminDb.emailMessage.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  return (
    <main className="portal-density mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-semibold">Dev outbox</h1>
      <p className="mt-1 text-muted-foreground">Emails captured by the mock email provider. Newest first.</p>
      {messages.length === 0 ? <p className="mt-8 text-muted-foreground">No emails yet.</p> : null}
      <ul className="mt-6 space-y-6">
        {messages.map((m) => {
          const links = [...m.html.matchAll(/href="([^"]+)"/g)].map((x) => x[1]!.replace(/&amp;/g, "&"));
          return (
            <li key={m.id} className="rounded-card border border-border bg-surface p-4" data-testid="outbox-message">
              <div className="text-sm text-muted-foreground">
                To <strong className="text-foreground" data-testid="outbox-to">{m.to}</strong> · {m.createdAt.toLocaleString()}
              </div>
              <h2 className="mt-1 font-semibold">{m.subject}</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {links.map((l) => (
                  <li key={l}>
                    <a href={l} className="break-all font-medium text-primary underline" data-testid="outbox-link">{l}</a>
                  </li>
                ))}
              </ul>
              <iframe title={`Email: ${m.subject}`} srcDoc={m.html} sandbox="" className="mt-3 h-72 w-full rounded-lg border border-border bg-white" />
            </li>
          );
        })}
      </ul>
    </main>
  );
}
