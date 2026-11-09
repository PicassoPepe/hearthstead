"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Card, CardContent } from "@/components/ui/card";
import { createMyCompanyAction } from "@/server/actions/auth";

export function CompanyStep({ email }: { email: string }) {
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">One last thing</h1>
      <p className="mt-1 text-muted-foreground">You&apos;re signed in as <strong className="text-foreground">{email}</strong>. What&apos;s your company called?</p>
      <Card className="mt-6"><CardContent className="pt-5">
        <form noValidate className="grid gap-4" onSubmit={async (e) => { e.preventDefault(); setBusy(true); const r = await createMyCompanyAction(name); setBusy(false); if (r && !r.ok) setError(r.error); }}>
          <Field label="Company name" required error={error}>{(a) => <Input {...a} autoComplete="organization" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Button type="submit" size="lg" loading={busy}>Create workspace</Button>
        </form>
      </CardContent></Card>
    </div>
  );
}
