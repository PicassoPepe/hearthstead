"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runNightlyNow } from "@/server/actions/leasing";

/** Runs the nightly rent + late-fee job on demand (it's idempotent, so this is always safe). */
export function RunJobsButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        const r = await runNightlyNow();
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        const { charges, lateFees, ended } = r.data;
        toast.success(charges || lateFees || ended ? `Posted ${charges} charge${charges === 1 ? "" : "s"} and ${lateFees} late fee${lateFees === 1 ? "" : "s"}${ended ? `; ${ended} lease${ended === 1 ? "" : "s"} ended` : ""}` : "Everything is up to date");
        router.refresh();
      }}
    >
      <RefreshCw aria-hidden /> Run rent &amp; late fees
    </Button>
  );
}
