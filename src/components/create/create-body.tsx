import { Hammer } from "lucide-react";
import type { AppContext } from "@/server/context";
import { can } from "@/server/permissions";
import { createItem, type CreateKind } from "@/lib/nav";
import { Forbidden } from "@/components/patterns/forbidden";
import { InviteUserForm } from "./invite-user-form";

/** Renders the right create form for a kind. Later phases add their forms/wizards here. */
export async function CreateBody({ kind, ctx, mode }: { kind: CreateKind; ctx: AppContext; mode: "modal" | "page" }) {
  const item = createItem(kind)!;
  if (!can(ctx.permissions, item.module, "edit")) return <Forbidden what={`creating ${item.label.toLowerCase()}s`} />;

  switch (kind) {
    case "user": {
      const roles = await ctx.db.role.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, description: true } });
      return <InviteUserForm roles={roles} mode={mode} />;
    }
    default:
      return (
        <div className="flex flex-col items-center py-6 text-center">
          <div aria-hidden className="mb-3 flex size-10 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <Hammer className="size-5" />
          </div>
          <p className="font-medium">Creating a {item.label.toLowerCase()} arrives in Phase {item.phase}.</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            The modal-route framework is live — this form plugs in here without changing navigation.
          </p>
        </div>
      );
  }
}
