"use client";

import * as React from "react";
import { MailWarning } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resendVerificationAction } from "@/server/actions/auth";

/** Shown until the account's email is confirmed. */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [busy, setBusy] = React.useState(false);
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning-soft px-4 py-2 text-sm text-warning-soft-foreground" data-testid="verify-email-banner">
      <MailWarning className="size-4 shrink-0" aria-hidden />
      <span className="flex-1"><strong>Please confirm your email.</strong> We sent a link to {email}. Until then you can&apos;t create API keys or connect payments.</span>
      <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
        setBusy(true);
        const r = await resendVerificationAction();
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        toast.success(r.message ?? "Sent");
      }}>Send it again</Button>
    </div>
  );
}
