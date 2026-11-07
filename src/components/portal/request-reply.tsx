"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { replyToRequest } from "@/server/actions/portal";

export function RequestReply({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [body, setBody] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  return (
    <form
      className="grid gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const r = await replyToRequest(taskId, body);
        setBusy(false);
        if (!r.ok) return void toast.error(r.error);
        setBody("");
        toast.success("Message sent");
        router.refresh();
      }}
    >
      <label htmlFor="reply" className="text-sm font-medium">Add a message</label>
      <Textarea id="reply" value={body} onChange={(e) => setBody(e.target.value)} />
      <Button type="submit" loading={busy} disabled={!body.trim()}>Send</Button>
    </form>
  );
}
