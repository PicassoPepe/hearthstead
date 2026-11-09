import { DraftNotice } from "@/components/marketing/legal-draft";
import { BRAND, siteUrl } from "@/lib/seo/site";

export const metadata = { title: "Terms of service", description: "The terms for using DeedWood.", alternates: { canonical: `${siteUrl()}/terms` } };

const S = ({ h, children }: { h: string; children: React.ReactNode }) => <section className="mt-8"><h2 className="text-xl font-semibold">{h}</h2><div className="mt-2 grid gap-2 leading-relaxed text-muted-foreground">{children}</div></section>;

export default function TermsPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="font-display text-4xl font-bold tracking-tight">Terms of service</h1>
      <DraftNotice />
      <S h="1. Who we are">{<p>DeedWood is provided by {BRAND.legalName} (“DeedWood”, “we”). By creating an account or using DeedWood you agree to these terms on behalf of yourself and the company you represent (“you”).</p>}</S>
      <S h="2. Your account">{<p>Keep your sign-in details safe and use two-factor authentication. You’re responsible for what happens under your account and for the people you invite.</p>}</S>
      <S h="3. Your data">{<><p>You own the information you put into DeedWood, including information about your tenants and owners. You give us permission to store and process it only to run the service for you.</p><p>You’re responsible for having the right to collect and use that information, and for following the laws that apply to you, including fair housing, consumer reporting and landlord-tenant laws.</p></>}</S>
      <S h="4. Not legal, tax or accounting advice">{<p>Templates, calculations, reports and land records are tools, not advice. Public records can be out of date. Check important decisions with a qualified professional.</p>}</S>
      <S h="5. Payments and plans">{<p>Plans are billed monthly or yearly in advance. If a payment fails we’ll let you know; after a short grace period your account may become read-only until it’s paid. We never delete your data because of a failed payment.</p>}</S>
      <S h="6. Acceptable use">{<p>Don’t use DeedWood to break the law, discriminate, send spam, or try to access other companies’ data.</p>}</S>
      <S h="7. Ending your account">{<p>You can cancel any time. You can export your data before you leave.</p>}</S>
      <S h="8. Liability">{<p>DeedWood is provided “as is”. To the extent the law allows, our liability is limited to the amount you paid us in the 12 months before the claim.</p>}</S>
      <S h="9. Changes">{<p>We’ll tell you before material changes to these terms take effect.</p>}</S>
    </article>
  );
}
