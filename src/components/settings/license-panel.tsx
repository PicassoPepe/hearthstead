"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { installLicenseAction } from "@/server/actions/platform";

export function InstallLicense() {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  return (
    <form className="grid gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      const r = await installLicenseAction(text);
      setBusy(false);
      if (!r.ok) { setError(r.error); return void toast.error(r.error); }
      setError(undefined);
      setText("");
      toast.success("License added — thank you!");
      router.refresh();
    }}>
      <Field label="Paste your license" description="Copy the whole text from DeedWood's email — it starts with DW1." error={error}>{(a) => <Textarea {...a} rows={4} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      <div><Button type="submit" loading={busy} disabled={!text.trim()}>Add license</Button></div>
    </form>
  );
}
