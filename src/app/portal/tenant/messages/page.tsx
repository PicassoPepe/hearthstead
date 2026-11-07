import { Card } from "@/components/ui/card";

export const metadata = { title: "Messages" };

export default function Page() {
  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
      <Card className="p-6 text-muted-foreground">Two-way messages with your property manager (also by text). <span className="block pt-2 text-sm">Arrives in Phase 8. Until then, contact your property manager directly.</span></Card>
    </div>
  );
}
