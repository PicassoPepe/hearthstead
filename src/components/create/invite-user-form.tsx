"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { inviteSchema, type InviteInput } from "@/lib/schemas";
import { inviteMember } from "@/server/actions/members";
import { useCreateModal } from "./create-modal";

export function InviteUserForm({ roles, mode }: { roles: { id: string; name: string; description: string | null }[]; mode: "modal" | "page" }) {
  const router = useRouter();
  const modal = useCreateModal();
  const form = useForm<InviteInput>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { name: "", email: "", roleId: roles.find((r) => r.name === "Property Manager")?.id ?? roles[0]?.id ?? "" },
  });
  const e = form.formState.errors;
  const roleId = form.watch("roleId");
  const role = roles.find((r) => r.id === roleId);

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={form.handleSubmit(async (v) => {
        const r = await inviteMember(v);
        if (!r.ok) {
          for (const [k, msg] of Object.entries(r.fieldErrors ?? {})) form.setError(k as keyof InviteInput, { message: msg });
          toast.error(r.error);
          return;
        }
        toast.success(`Invitation sent to ${v.email}`);
        if (mode === "modal" && modal) {
          modal.close();
          router.refresh();
        } else {
          router.push("/app/settings/users");
        }
      })}
    >
      <Field label="Full name" error={e.name?.message} required>
        {(a) => <Input autoComplete="off" {...a} {...form.register("name")} />}
      </Field>
      <Field label="Email" error={e.email?.message} required>
        {(a) => <Input type="email" autoComplete="off" {...a} {...form.register("email")} />}
      </Field>
      <Field label="Role" description={role?.description ?? undefined} error={e.roleId?.message} required>
        {(a) => (
          <NativeSelect {...a} {...form.register("roleId")}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <div className="flex justify-end gap-2 pt-2">
        {mode === "modal" && modal ? (
          <Button type="button" variant="secondary" onClick={modal.close}>Cancel</Button>
        ) : null}
        <Button type="submit" loading={form.formState.isSubmitting}>Send invitation</Button>
      </div>
    </form>
  );
}
