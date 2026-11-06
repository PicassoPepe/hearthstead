import { ComingSoon } from "@/components/patterns/coming-soon";

export const metadata = { title: "Owner portal" };

export default function OwnerPortal() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <ComingSoon title="Owner portal" phase={8} description="Mobile-first portal branded with your company's logo and colors." />
    </main>
  );
}
