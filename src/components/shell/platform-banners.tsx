"use client";

import * as React from "react";
import { Eye, Info, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { endImpersonationAction } from "@/server/actions/admin";

/** Always visible while the platform owner is viewing a company as one of its members. */
export function ImpersonationBanner({ name, org, expiresAt, reason }: { name: string; org: string; expiresAt: string; reason: string }) {
  const [busy, setBusy] = React.useState(false);
  const until = new Date(expiresAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 border-b border-warning/40 bg-warning-soft px-4 py-2 text-sm text-warning-soft-foreground" data-testid="impersonation-banner">
      <Eye className="size-4 shrink-0" aria-hidden />
      <span className="flex-1"><strong>Viewing as {name}</strong> at {org} until {until}. Everything you change is recorded as made by you. <span className="opacity-80">Reason: {reason}</span></span>
      <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
        setBusy(true);
        const r = await endImpersonationAction();
        if (!r.ok) { setBusy(false); return void toast.error(r.error); }
        window.location.assign(r.data.orgId ? `/admin/orgs/${r.data.orgId}` : "/admin");
      }}>Stop viewing</Button>
    </div>
  );
}

/** Notice from DeedWood (owner console → Announcements). Hidden per browser once closed. */
export function PlatformNotice({ id, title, body, level }: { id: string; title: string; body: string; level: "INFO" | "WARNING" }) {
  const key = `dw-notice-${id}`;
  const [hidden, setHidden] = React.useState(true);
  React.useEffect(() => {
    try { setHidden(localStorage.getItem(key) === "1"); } catch { setHidden(false); }
  }, [key]);
  if (hidden) return null;
  const Icon = level === "WARNING" ? TriangleAlert : Info;
  return (
    <div role="status" className={`flex items-start gap-3 border-b px-4 py-2 text-sm ${level === "WARNING" ? "border-warning/40 bg-warning-soft text-warning-soft-foreground" : "border-info/30 bg-info-soft text-info-soft-foreground"}`}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span className="flex-1"><strong>{title}</strong> — {body}</span>
      <button type="button" aria-label="Hide this notice" className="rounded p-0.5 hover:bg-black/5" onClick={() => { try { localStorage.setItem(key, "1"); } catch { /* private window */ } setHidden(true); }}><X className="size-4" aria-hidden /></button>
    </div>
  );
}
