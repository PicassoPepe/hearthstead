import { ComingSoon } from "@/components/patterns/coming-soon";

export const metadata = { title: "Listings" };

export default function ListingsPage() {
  return (
    <main className="portal-density mx-auto max-w-3xl px-4 py-10">
      <ComingSoon title="Available rentals" phase={9} description="Vacant units with photos, “Book a tour” and “Apply”." />
    </main>
  );
}
