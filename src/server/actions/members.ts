"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { inviteSchema, type InviteInput } from "@/lib/schemas";
import { requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { adminDb } from "@/server/db";
import { audit } from "@/server/audit";
import { getEmailProvider } from "@/adapters";
import { inviteEmail } from "@/server/emails";
import { LEVELS, MODULES, type Module, type Level } from "@/server/permissions";

export async function inviteMember(input: InviteInput): Promise<ActionResult<{ membershipId: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("users", "edit");
    const data = inviteSchema.parse(input);
    const email = data.email.toLowerCase();
    const role = await ctx.db.role.findFirst({ where: { id: data.roleId } });
    if (!role) throw new UserFacingError("Choose a valid role", { roleId: "Choose a valid role" });

    // Users are global identities: find-or-create via the system client (no tenant data).
    const user =
      (await adminDb.user.findUnique({ where: { email } })) ??
      (await adminDb.user.create({ data: { email, name: data.name, createdById: ctx.user.id } }));

    const existing = await ctx.db.membership.findFirst({ where: { userId: user.id, deletedAt: undefined } });
    if (existing && !existing.deletedAt) throw new UserFacingError("That person is already on your team.", { email: "Already a member" });

    const membership = existing
      ? await ctx.db.membership.update({ where: { id: existing.id }, data: { deletedAt: null, status: "INVITED", roleId: role.id, invitedAt: new Date() } })
      : await ctx.db.membership.create({
          data: { organizationId: ctx.org.id, userId: user.id, roleId: role.id, status: "INVITED", invitedAt: new Date(), createdById: ctx.user.id },
        });

    const base = process.env.AUTH_URL ?? "http://localhost:3000";
    const url = `${base}/login?email=${encodeURIComponent(email)}&invited=1`;
    await getEmailProvider().send({
      to: email,
      organizationId: ctx.org.id,
      ...inviteEmail({ orgName: ctx.org.name, inviterName: ctx.user.name ?? ctx.user.email, roleName: role.name, url }),
    });
    await audit(ctx.db, { action: "member.invited", entityType: "Membership", entityId: membership.id, after: { email, role: role.name } });
    revalidatePath("/app/settings/users");
    return { membershipId: membership.id };
  }, "Invitation sent");
}

export async function changeMemberRole(input: { membershipId: string; roleId: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("users", "edit");
    const m = await ctx.db.membership.findFirst({ where: { id: input.membershipId } });
    const role = await ctx.db.role.findFirst({ where: { id: input.roleId } });
    if (!m || !role) throw new UserFacingError("Not found");
    if (m.userId === ctx.user.id && role.key !== "ADMIN") throw new UserFacingError("You can't remove your own Admin role.");
    await ctx.db.membership.update({ where: { id: m.id }, data: { roleId: role.id } });
    await audit(ctx.db, { action: "member.role_changed", entityType: "Membership", entityId: m.id, before: { roleId: m.roleId }, after: { roleId: role.id } });
    revalidatePath("/app/settings/users");
  }, "Role updated");
}

export async function removeMember(input: { membershipId: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("users", "delete");
    const m = await ctx.db.membership.findFirst({ where: { id: input.membershipId } });
    if (!m) throw new UserFacingError("Not found");
    if (m.userId === ctx.user.id) throw new UserFacingError("You can't remove yourself.");
    await ctx.db.membership.update({ where: { id: m.id }, data: { deletedAt: new Date(), status: "SUSPENDED" } });
    await audit(ctx.db, { action: "member.removed", entityType: "Membership", entityId: m.id });
    revalidatePath("/app/settings/users");
  }, "Member removed");
}

export async function restoreMember(input: { membershipId: string }): Promise<ActionResult> {
  return runAction(async () => {
    const ctx = await requirePermission("users", "delete");
    await ctx.db.membership.updateMany({ where: { id: input.membershipId, deletedAt: { not: null } }, data: { deletedAt: null, status: "ACTIVE" } });
    await audit(ctx.db, { action: "member.restored", entityType: "Membership", entityId: input.membershipId });
    revalidatePath("/app/settings/users");
  }, "Member restored");
}

const roleSchema = z.object({
  roleId: z.string().optional(),
  name: z.string().trim().min(2, "Name the role").max(60),
  description: z.string().trim().max(200).optional(),
  permissions: z.record(z.enum(MODULES), z.enum(LEVELS)),
});

export async function saveRole(input: z.input<typeof roleSchema>): Promise<ActionResult<{ roleId: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("users", "edit");
    const data = roleSchema.parse(input);
    const permissions = Object.fromEntries(MODULES.map((m) => [m, data.permissions[m] ?? "none"])) as Record<Module, Level>;
    if (data.roleId) {
      const role = await ctx.db.role.findFirst({ where: { id: data.roleId } });
      if (!role) throw new UserFacingError("Role not found");
      if (role.key === "ADMIN") throw new UserFacingError("The Admin role always has full access.");
      await ctx.db.role.update({ where: { id: role.id }, data: { name: data.name, description: data.description, permissions } });
      await audit(ctx.db, { action: "role.updated", entityType: "Role", entityId: role.id, before: role.permissions, after: permissions });
      revalidatePath("/app/settings/users");
      return { roleId: role.id };
    }
    const role = await ctx.db.role.create({
      data: { organizationId: ctx.org.id, name: data.name, description: data.description, permissions, createdById: ctx.user.id },
    });
    await audit(ctx.db, { action: "role.created", entityType: "Role", entityId: role.id, after: permissions });
    revalidatePath("/app/settings/users");
    return { roleId: role.id };
  }, "Role saved");
}
