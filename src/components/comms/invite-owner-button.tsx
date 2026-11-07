"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { inviteOwnerAction } from "@/server/actions/comms";

export function InviteOwnerButton({ ownerId, label }: { ownerId: string; label: string }) {
  const router = useRouter();
  return <Button size="sm" variant="secondary" onClick={async () => { const r = await inviteOwnerAction(ownerId); if (!r.ok) return void toast.error(r.error); toast.success(`Invite sent to ${r.data.email}`); router.refresh(); }}>{label}</Button>;
}
