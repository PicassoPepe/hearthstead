"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inviteToPortal, previewPortalAs } from "@/server/actions/payments";

export function TenantPortalActions({ tenantId, status, hasEmail, canInvite }: { tenantId: string; status: string; hasEmail: boolean; canInvite: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [previewing, setPreviewing] = React.useState(false);
  return (
    <>
      {canInvite ? (
        <Button
          variant="secondary"
          loading={busy}
          disabled={!hasEmail}
          title={hasEmail ? undefined : "Add an email address first"}
          onClick={async () => {
            setBusy(true);
            const r = await inviteToPortal([tenantId]);
            setBusy(false);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Portal invitation sent");
            router.refresh();
          }}
        >
          <Mail aria-hidden /> {status === "NOT_INVITED" ? "Invite to portal" : "Re-send invite"}
        </Button>
      ) : null}
      <Button variant="secondary" loading={previewing} onClick={() => { setPreviewing(true); void previewPortalAs(tenantId); }}>
        <Eye aria-hidden /> Preview portal as
      </Button>
    </>
  );
}
