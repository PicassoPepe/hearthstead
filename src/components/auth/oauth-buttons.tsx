"use client";

import * as React from "react";
import { oauthSignInAction } from "@/server/actions/auth";
import type { OAuthProvider } from "@/server/auth/oauth";

const ICONS: Record<OAuthProvider["id"], React.ReactNode> = {
  google: <svg aria-hidden viewBox="0 0 24 24" className="size-5"><path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h5.9c-.3 1.4-1 2.5-2.2 3.3v2.7h3.6c2.1-1.9 3.3-4.8 3.3-8.1z"/><path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.1v2.8C3.9 20.6 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.8 14.2c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2V7H2.1C1.4 8.5 1 10.2 1 12s.4 3.5 1.1 5l3.7-2.8z"/><path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2C17.5 2.1 15 1 12 1 7.7 1 3.9 3.4 2.1 7l3.7 2.8C6.7 7.3 9.1 5.4 12 5.4z"/></svg>,
  "microsoft-entra-id": <svg aria-hidden viewBox="0 0 24 24" className="size-5"><path fill="#F25022" d="M2 2h9.5v9.5H2z"/><path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z"/><path fill="#00A4EF" d="M2 12.5h9.5V22H2z"/><path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z"/></svg>,
};

/** "Sign in with Google / Microsoft" — only providers whose keys are configured are passed in. */
export function OAuthButtons({ providers, callbackUrl, verb = "Continue" }: { providers: OAuthProvider[]; callbackUrl: string; verb?: string }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!providers.length) return null;
  return (
    <div className="grid gap-2">
      {providers.map((p) => (
        <button key={p.id} type="button" disabled={Boolean(busy)} onClick={async () => { setBusy(p.id); await oauthSignInAction(p.id, callbackUrl); }}
          className="flex h-11 items-center justify-center gap-2 rounded-lg border border-border-strong bg-surface font-medium hover:bg-surface-muted disabled:opacity-60">
          {ICONS[p.id]}{busy === p.id ? "Opening…" : `${verb} with ${p.label}`}
        </button>
      ))}
      <p className="text-center text-xs text-muted-foreground">or use your email</p>
    </div>
  );
}
