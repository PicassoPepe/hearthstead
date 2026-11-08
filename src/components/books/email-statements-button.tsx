"use client";

import * as React from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emailOwnerStatementsNow } from "@/server/actions/books";

export function EmailStatementsButton() {
  const [busy, setBusy] = React.useState(false);
  return (
    <Button variant="secondary" loading={busy} onClick={async () => {
      setBusy(true);
      const r = await emailOwnerStatementsNow();
      setBusy(false);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data.sent ? `Emailed ${r.data.sent} owner statement${r.data.sent === 1 ? "" : "s"}` : "Every owner already has last month's statement");
    }}><Mail aria-hidden /> Email last month&apos;s statements</Button>
  );
}
