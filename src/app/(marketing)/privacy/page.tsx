import { DraftNotice } from "@/components/marketing/legal-draft";
import { BRAND, siteUrl } from "@/lib/seo/site";

export const metadata = { title: "Privacy policy", description: "What information DeedWood collects, why, and how it's protected.", alternates: { canonical: `${siteUrl()}/privacy` } };

const S = ({ h, children }: { h: string; children: React.ReactNode }) => <section className="mt-8"><h2 className="text-xl font-semibold">{h}</h2><div className="mt-2 grid gap-2 leading-relaxed text-muted-foreground">{children}</div></section>;

export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="font-display text-4xl font-bold tracking-tight">Privacy policy</h1>
      <DraftNotice />
      <S h="What we collect">{<><p>Account details (name, email, password stored only as a secure hash), the information companies enter about properties, tenants, owners and money, and basic technical information (like sign-in times and device type) to keep accounts secure.</p></>}</S>
      <S h="How we use it">{<p>Only to provide and secure DeedWood, support you, and send the messages you ask us to send. We don’t sell personal information.</p>}</S>
      <S h="Tenants and owners">{<p>If you’re a tenant or owner, the property company you deal with controls your information. Contact them for access or corrections; we’ll help them respond.</p>}</S>
      <S h="Search engines">{<p>Portals, sign-in pages, signed documents and tenant information are never shown to search engines. Only pages a company chooses to publish (like its rental website) are public.</p>}</S>
      <S h="Security">{<p>Each company’s data is isolated at the database level, accounts can use two-factor sign-in, and access is logged. See our Security page.</p>}</S>
      <S h="Service providers">{<p>We use providers for hosting, email, text messages and (when enabled) payments. They may only use information to provide their service to us.</p>}</S>
      <S h="Contact">{<p>{BRAND.email ? <>Questions? Email {BRAND.email}.</> : <>Questions? Contact {BRAND.legalName} through the app’s Help page.</>}</p>}</S>
    </article>
  );
}
