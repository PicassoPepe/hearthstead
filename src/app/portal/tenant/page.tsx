import { ComingSoon } from "@/components/patterns/coming-soon";

export const metadata = { title: "Tenant portal" };

export default function TenantPortal() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <ComingSoon title="Tenant portal" phase={4} description="Mobile-first portal branded with your company's logo and colors." />
    </main>
  );
}
