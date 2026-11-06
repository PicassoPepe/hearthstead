"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, NativeSelect } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LEVELS, MODULES, MODULE_LABELS, type Level, type Module } from "@/server/permissions";
import { saveRole } from "@/server/actions/members";

export type RoleRow = { id: string; key: string | null; name: string; description: string | null; isSystem: boolean; permissions: Partial<Record<Module, Level>>; memberCount: number };

const LEVEL_LABEL: Record<Level, string> = { none: "No access", view: "View", edit: "Edit", delete: "Full" };
const LEVEL_TONE: Record<Level, "outline" | "info" | "primary" | "success"> = { none: "outline", view: "info", edit: "primary", delete: "success" };

export function RolesEditor({ roles, canEdit }: { roles: RoleRow[]; canEdit: boolean }) {
  const [editing, setEditing] = React.useState<RoleRow | "new" | null>(null);
  return (
    <>
      <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Role permissions by module</caption>
          <thead className="bg-surface-muted/60 text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th scope="col" className="h-10 px-3 font-medium">Module</th>
              {roles.map((r) => (
                <th key={r.id} scope="col" className="h-10 whitespace-nowrap px-3 font-medium">
                  <div className="flex items-center gap-1">
                    {r.name}
                    {canEdit && r.key !== "ADMIN" ? (
                      <Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Edit ${r.name} role`} onClick={() => setEditing(r)}>
                        <Pencil className="size-3.5" aria-hidden />
                      </Button>
                    ) : null}
                  </div>
                  <div className="font-normal">{r.memberCount} member{r.memberCount === 1 ? "" : "s"}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MODULES.map((m) => (
              <tr key={m} className="border-b border-border last:border-0">
                <th scope="row" className="h-10 whitespace-nowrap px-3 font-medium">{MODULE_LABELS[m]}</th>
                {roles.map((r) => {
                  const lvl = r.permissions[m] ?? "none";
                  return (
                    <td key={r.id} className="px-3">
                      <Badge tone={LEVEL_TONE[lvl]}>{LEVEL_LABEL[lvl]}</Badge>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <Button variant="secondary" className="mt-3" onClick={() => setEditing("new")}>
          <Plus aria-hidden /> New custom role
        </Button>
      ) : null}
      {editing ? <RoleDialog role={editing === "new" ? null : editing} onClose={() => setEditing(null)} /> : null}
    </>
  );
}

function RoleDialog({ role, onClose }: { role: RoleRow | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = React.useState(role?.name ?? "");
  const [description, setDescription] = React.useState(role?.description ?? "");
  const [perms, setPerms] = React.useState<Record<Module, Level>>(
    Object.fromEntries(MODULES.map((m) => [m, role?.permissions[m] ?? "none"])) as Record<Module, Level>,
  );
  const [error, setError] = React.useState<string>();
  const [busy, setBusy] = React.useState(false);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" aria-describedby="role-desc">
        <DialogHeader>
          <DialogTitle>{role ? `Edit ${role.name}` : "New custom role"}</DialogTitle>
          <DialogDescription id="role-desc">Set the access level for each module. Server-side checks enforce these on every action.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <Field label="Role name" error={error} required>
            {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Description">
            {(a) => <Input {...a} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-[13px] font-medium">Permissions</legend>
            {MODULES.map((m) => (
              <div key={m} className="flex items-center justify-between gap-3">
                <label htmlFor={`perm-${m}`} className="text-sm">{MODULE_LABELS[m]}</label>
                <NativeSelect id={`perm-${m}`} className="w-36" value={perms[m]} onChange={(e) => setPerms((p) => ({ ...p, [m]: e.target.value as Level }))}>
                  {LEVELS.map((l) => <option key={l} value={l}>{LEVEL_LABEL[l]}</option>)}
                </NativeSelect>
              </div>
            ))}
          </fieldset>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              const r = await saveRole({ roleId: role?.id, name, description, permissions: perms });
              setBusy(false);
              if (!r.ok) {
                setError(r.fieldErrors?.name);
                toast.error(r.error);
                return;
              }
              toast.success(`${name} role saved`);
              onClose();
              router.refresh();
            }}
          >
            Save role
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
