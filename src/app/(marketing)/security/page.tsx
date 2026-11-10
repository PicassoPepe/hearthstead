import { siteUrl } from "@/lib/seo/site";

export const metadata = { title: "Security", description: "How DeedWood protects your company's and your tenants' information: data isolation, two-factor sign-in, sign-in limits, audit logs and secure cookies.", alternates: { canonical: `${siteUrl()}/security` } };

const ITEMS = [
  ["Each company's data is walled off", "Every record belongs to one company, and the database itself refuses to show it to anyone else (row-level security) — a second lock on top of the app's own checks."],
  ["Two-factor sign-in", "Turn on a code from an authenticator app for every staff account. DeedWood's own administrators must use it."],
  ["Limits on guessing", "Accounts lock for 15 minutes after repeated wrong passwords, and repeated sign-in attempts are slowed down."],
  ["Everything is logged", "Changes to money, leases, settings and access are recorded with who made them and when."],
  ["Private by default", "Resident portals, sign-in pages and documents are never shown to search engines."],
  ["Card details never touch our servers", "When online payments are on, cards and bank accounts are handled by the payment processor."],
];

export default function SecurityPage() {
  return (
    <div className="px-4 py-14 sm:py-20">
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-4xl font-bold tracking-tight">Security</h1>
        <p className="mt-3 text-lg text-muted-foreground">You’re trusting DeedWood with your business and your tenants’ information. Here’s how we protect it.</p>
        <ul className="mt-8 grid gap-4">{ITEMS.map(([t, d]) => <li key={t} className="rounded-card border border-border bg-surface p-5"><h2 className="font-semibold">{t}</h2><p className="mt-1 text-muted-foreground">{d}</p></li>)}</ul>
      </div>
    </div>
  );
}
