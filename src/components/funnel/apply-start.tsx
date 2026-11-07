"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { startApplicationAction } from "@/server/actions/public";

export function ApplyStart({ orgSlug, slug }: { orgSlug: string; slug: string }) {
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);
  return (
    <form noValidate className="grid gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await startApplicationAction(orgSlug, slug, email);
      setBusy(false);
      if (r && !r.ok) { setError(r.fieldErrors?.email); toast.error(r.error); }
    }}>
      <Field label="Your email" required error={error} description="Already started? Use the same email to pick up where you left off.">{(a) => <Input {...a} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <Button type="submit" loading={busy}>Start application</Button>
    </form>
  );
}
