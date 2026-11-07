"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { confirm2faAction, disable2faAction, revokeSessionAction, setSupportAccessAction, start2faAction } from "@/server/actions/platform";

export function TwoFactor({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = React.useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  if (codes) {
    return (
      <div className="grid gap-3">
        <p className="flex items-center gap-2 font-medium text-success"><ShieldCheck className="size-5" aria-hidden /> Two-factor authentication is on.</p>
        <p className="text-sm">Save these recovery codes somewhere safe. Each works once if you lose your device. They won&apos;t be shown again.</p>
        <ul className="grid grid-cols-2 gap-1 rounded-lg bg-surface-muted p-3 font-mono text-sm sm:grid-cols-4" data-testid="recovery-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <Button className="justify-self-start" onClick={() => { setCodes(null); router.refresh(); }}>I&apos;ve saved them</Button>
      </div>
    );
  }
  if (enabled) {
    return (
      <form className="flex flex-wrap items-end gap-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await disable2faAction(code); setBusy(false); if (!r.ok) return void toast.error(r.error); toast.success(r.message); setCode(""); router.refresh(); }}>
        <p className="w-full flex items-center gap-2 text-sm"><Badge tone="success">On</Badge> You&apos;ll be asked for a code from your authenticator app when signing in with a password.</p>
        <Field label="Code to turn off">{(a) => <Input {...a} className="w-40" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
        <Button type="submit" variant="secondary" loading={busy}>Turn off</Button>
      </form>
    );
  }
  if (setup) {
    return (
      <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await confirm2faAction(code); setBusy(false); if (!r.ok) return void toast.error(r.error); setCodes(r.data.recoveryCodes); }}>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Open an authenticator app (1Password, Google Authenticator, Authy…) and add an account by setup key.</li>
          <li>Enter this key: <code className="break-all rounded bg-surface-muted px-1.5 py-0.5" data-testid="totp-secret">{setup.secret}</code> — or open <a className="text-primary underline" href={setup.uri}>this link</a> on the device with the app.</li>
          <li>Type the 6-digit code it shows.</li>
        </ol>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="6-digit code" required>{(a) => <Input {...a} className="w-40" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />}</Field>
          <Button type="submit" loading={busy}>Verify &amp; turn on</Button>
          <Button type="button" variant="ghost" onClick={() => setSetup(null)}>Cancel</Button>
        </div>
      </form>
    );
  }
  return <Button onClick={async () => { const r = await start2faAction(); if (!r.ok) return void toast.error(r.error); setSetup(r.data); }}>Set up two-factor authentication</Button>;
}

export function Sessions({ sessions }: { sessions: { id: string; device: string; ip: string | null; lastSeen: string; current: boolean }[] }) {
  const router = useRouter();
  const revoke = async (id: string) => { const r = await revokeSessionAction(id); if (!r.ok) return void toast.error(r.error); toast.success(id === "others" ? `Signed out ${r.data} other session${r.data === 1 ? "" : "s"}` : "Session signed out"); router.refresh(); };
  return (
    <div className="grid gap-2">
      <ul className="divide-y divide-border text-sm">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="flex-1"><span className="font-medium">{s.device}</span>{s.current ? <Badge tone="primary" className="ml-2">This device</Badge> : null}<span className="block text-xs text-muted-foreground">{s.ip ?? "Unknown IP"} · last active {new Date(s.lastSeen).toLocaleString()}</span></span>
            {!s.current ? <Button size="sm" variant="ghost" onClick={() => revoke(s.id)} aria-label={`Sign out ${s.device}`}>Sign out</Button> : null}
          </li>
        ))}
      </ul>
      {sessions.filter((s) => !s.current).length ? <Button className="justify-self-start" variant="secondary" onClick={() => revoke("others")}>Sign out all other sessions</Button> : null}
    </div>
  );
}

export function SupportAccess({ until }: { until: string | null }) {
  const router = useRouter();
  const on = Boolean(until && new Date(until) > new Date());
  return (
    <label className="flex items-start gap-3 text-sm">
      <Switch checked={on} aria-label="Allow support access" onCheckedChange={async (v) => { const r = await setSupportAccessAction(v); if (!r.ok) return void toast.error(r.error); toast.success(r.message); router.refresh(); }} />
      <span>Allow Hearthstead support to access this workspace to help troubleshoot{on ? <> — <strong>on until {new Date(until!).toLocaleDateString()}</strong>. It turns off automatically.</> : ". Access lasts 30 days and every action is audit-logged."}</span>
    </label>
  );
}
