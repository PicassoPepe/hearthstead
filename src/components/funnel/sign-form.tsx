"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { declineSignAction, signAction } from "@/server/actions/public";

export function SignForm({ token, name }: { token: string; name: string }) {
  const router = useRouter();
  const [typed, setTyped] = React.useState("");
  const [agree, setAgree] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState("");
  return (
    <form noValidate className="grid gap-3" onSubmit={async (e) => {
      e.preventDefault();
      setBusy("sign");
      const r = await signAction(token, typed, agree);
      setBusy("");
      if (!r.ok) { setErrors(r.fieldErrors ?? {}); return void toast.error(r.error); }
      toast.success(r.data.completed ? "Signed — everyone has signed, and a copy is on its way" : "Signed — thank you!");
      router.refresh();
    }}>
      <Field label="Type your full name to sign" required error={errors.name} description={`Exactly as shown: ${name}`}>{(a) => <Input {...a} autoComplete="name" value={typed} onChange={(e) => setTyped(e.target.value)} className="font-[cursive] text-lg" />}</Field>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>I agree to sign this document electronically. My typed name is my signature and is legally binding, the same as a handwritten one.</span></label>
      {errors.agree ? <p role="alert" className="text-sm text-danger">{errors.agree}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy === "sign"}>Sign document</Button>
        <Button type="button" variant="ghost" loading={busy === "decline"} onClick={async () => {
          const reason = window.prompt("Why are you declining? (optional)") ?? "";
          setBusy("decline");
          const r = await declineSignAction(token, reason);
          setBusy("");
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          router.refresh();
        }}>Decline to sign</Button>
      </div>
    </form>
  );
}
