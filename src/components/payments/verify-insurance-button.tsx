"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { verifyInsurance } from "@/server/actions/payments";

export function VerifyInsuranceButton({ id, verified }: { id: string; verified: boolean }) {
  const router = useRouter();
  return (
    <Button size="sm" variant="secondary" onClick={async () => {
      const r = await verifyInsurance(id, verified ? "PENDING_REVIEW" : "VERIFIED");
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message ?? "Saved");
      router.refresh();
    }}>
      {verified ? "Mark for review" : "Mark verified"}
    </Button>
  );
}
