import { Card } from "@/components/ui/card";

export const metadata = { title: "Maintenance requests" };

export default function Page() {
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Maintenance requests</h1>
      <Card className="p-6 text-muted-foreground">Submit repair requests with photos, permission to enter and preferred times — and track every step. <span className="block pt-2 text-sm">Arrives in Phase 5. Until then, contact your property manager directly.</span></Card>
    </div>
  );
}
