"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { createAnnouncementAction, endAnnouncementAction, publishReleaseAction } from "@/server/actions/admin";

export function AnnouncementForm() {
  const router = useRouter();
  const [v, setV] = React.useState({ title: "", body: "", level: "INFO" as "INFO" | "WARNING", orgIds: "", endsAt: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  return (
    <form className="grid gap-3 sm:grid-cols-2" noValidate onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await createAnnouncementAction({ title: v.title, body: v.body, level: v.level, orgIds: v.orgIds.split(/[\s,]+/).filter(Boolean), endsAt: v.endsAt || null });
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      toast.success("Announcement posted");
      setV({ title: "", body: "", level: "INFO", orgIds: "", endsAt: "" });
      router.refresh();
    }}>
      <Field label="Title" required error={errors.title} className="sm:col-span-2">{(a) => <Input {...a} value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} />}</Field>
      <Field label="Message" required error={errors.body} className="sm:col-span-2">{(a) => <Textarea {...a} rows={3} value={v.body} onChange={(e) => setV({ ...v, body: e.target.value })} />}</Field>
      <Field label="Kind">{(a) => <NativeSelect {...a} value={v.level} onChange={(e) => setV({ ...v, level: e.target.value as "INFO" | "WARNING" })}><option value="INFO">Information</option><option value="WARNING">Important</option></NativeSelect>}</Field>
      <Field label="Stop showing on (optional)">{(a) => <Input {...a} type="date" value={v.endsAt} onChange={(e) => setV({ ...v, endsAt: e.target.value })} />}</Field>
      <Field label="Only these company IDs (optional)" description="Leave empty for every company." className="sm:col-span-2">{(a) => <Input {...a} value={v.orgIds} onChange={(e) => setV({ ...v, orgIds: e.target.value })} />}</Field>
      <div className="sm:col-span-2"><Button type="submit" loading={busy}>Post announcement</Button></div>
    </form>
  );
}

export function EndAnnouncementButton({ id }: { id: string }) {
  const router = useRouter();
  return <Button size="sm" variant="secondary" onClick={async () => { const r = await endAnnouncementAction(id); if (!r.ok) return void toast.error(r.error); toast.success("Taken down"); router.refresh(); }}>Take down</Button>;
}

export function ReleaseForm({ current }: { current: string }) {
  const router = useRouter();
  const [v, setV] = React.useState({ version: current, channel: "stable" as "stable" | "beta", notes: "", minVersion: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  return (
    <form className="grid gap-3 sm:grid-cols-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await publishReleaseAction({ version: v.version.trim(), channel: v.channel, notes: v.notes, minVersion: v.minVersion.trim() || null });
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      toast.success("Release published");
      router.refresh();
    }}>
      <Field label="Version" required error={errors.version}>{(a) => <Input {...a} value={v.version} onChange={(e) => setV({ ...v, version: e.target.value })} />}</Field>
      <Field label="Channel">{(a) => <NativeSelect {...a} value={v.channel} onChange={(e) => setV({ ...v, channel: e.target.value as "stable" | "beta" })}><option value="stable">Stable</option><option value="beta">Beta</option></NativeSelect>}</Field>
      <Field label="Minimum version (optional)" error={errors.minVersion} description="Older installs must update.">{(a) => <Input {...a} value={v.minVersion} onChange={(e) => setV({ ...v, minVersion: e.target.value })} />}</Field>
      <Field label="What's new" className="sm:col-span-3">{(a) => <Textarea {...a} rows={4} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />}</Field>
      <div className="sm:col-span-3"><Button type="submit" loading={busy}>Publish release</Button></div>
    </form>
  );
}

/** Choose a password (first time) or change it. */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const router = useRouter();
  const [v, setV] = React.useState({ current: "", next: "" });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  return (
    <form className="grid max-w-sm gap-3" noValidate onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const { changePasswordAction } = await import("@/server/actions/platform");
      const r = await changePasswordAction(hasPassword ? v.current : null, v.next);
      setBusy(false);
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      toast.success("Password saved");
      setV({ current: "", next: "" });
      router.refresh();
    }}>
      {hasPassword ? <Field label="Current password" error={errors.current}>{(a) => <Input {...a} type="password" autoComplete="current-password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} />}</Field> : null}
      <Field label={hasPassword ? "New password" : "Choose a password"} description="At least 10 characters." error={errors.next}>{(a) => <Input {...a} type="password" autoComplete="new-password" value={v.next} onChange={(e) => setV({ ...v, next: e.target.value })} />}</Field>
      <div><Button type="submit" loading={busy}>Save password</Button></div>
    </form>
  );
}
