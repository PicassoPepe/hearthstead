import type { Prisma } from "@prisma/client";
import type { ScopedDb } from "@/server/dal";

export type AuditInput = {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  actorType?: "USER" | "SYSTEM" | "AI" | "API";
};

function json(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
}

export async function audit(db: ScopedDb, input: AuditInput): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: db.ctx.orgId,
      actorId: db.ctx.userId,
      actorType: input.actorType ?? "USER",
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: json(input.before),
      after: json(input.after),
      createdById: db.ctx.userId,
    },
  });
}
