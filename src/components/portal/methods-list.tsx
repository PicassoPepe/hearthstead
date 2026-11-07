"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, CreditCard, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { removeMethod } from "@/server/actions/portal";

export function MethodsList({ methods, readOnly }: { methods: { id: string; type: "CARD" | "ACH"; label: string; detail: string; isDefault: boolean }[]; readOnly: boolean }) {
  const router = useRouter();
  if (!methods.length) return <p className="text-muted-foreground">No saved payment methods yet.</p>;
  return (
    <Card className="divide-y divide-border">
      {methods.map((m) => (
        <div key={m.id} className="flex items-center gap-3 px-4 py-3">
          {m.type === "CARD" ? <CreditCard className="size-5 text-muted-foreground" aria-hidden /> : <Building2 className="size-5 text-muted-foreground" aria-hidden />}
          <div className="min-w-0 flex-1">
            <div className="font-medium">{m.label} {m.isDefault ? <Badge tone="primary">Default</Badge> : null}</div>
            <div className="text-sm text-muted-foreground">{m.detail}</div>
          </div>
          {!readOnly ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove ${m.label}`}
              onClick={async () => {
                const r = await removeMethod(m.id);
                if (!r.ok) return void toast.error(r.error);
                toast.success("Payment method removed");
                router.refresh();
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
    </Card>
  );
}
