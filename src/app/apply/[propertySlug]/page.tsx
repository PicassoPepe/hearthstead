import { ComingSoon } from "@/components/patterns/coming-soon";

export const metadata = { title: "Apply" };

export default function ApplyPage() {
  return (
    <main className="portal-density mx-auto max-w-xl px-4 py-10">
      <ComingSoon title="Rental application" phase={9} description="A mobile-first application with autosave, co-applicants, fee payment and screening." />
    </main>
  );
}
