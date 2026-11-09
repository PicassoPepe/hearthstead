import Link from "next/link";
import { KeyRound } from "lucide-react";

/** Computer installs: trial days left, grace period, read-only, or an update notice. */
export function LicenseBanner({ message, readOnly, update }: { message: string; readOnly: boolean; update?: string | null }) {
  if (!message && !update) return null;
  return (
    <div role="status" className={`flex flex-wrap items-center gap-3 border-b px-4 py-2 text-sm ${readOnly ? "border-danger/40 bg-danger-soft text-danger-soft-foreground" : "border-warning/40 bg-warning-soft text-warning-soft-foreground"}`} data-testid="license-banner">
      <KeyRound className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{message}{update ? ` ${update}` : ""}</span>
      {message ? <Link href="/app/settings/billing" className="font-semibold underline underline-offset-4">Settings → Billing</Link> : null}
    </div>
  );
}
