import { PrismaClient } from "@prisma/client";
import { provisionOrganization, purgeOrganizations } from "@/server/orgs";

export const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_ADMIN_URL } } });
export const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

export async function makeOrg(label: string) {
  const tag = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const user = await admin.user.create({ data: { email: `${tag}@test.local`, name: `User ${label}` } });
  const { orgId } = await provisionOrganization(admin, { name: `Test ${label}`, slug: `t-${tag}`, ownerUserId: user.id });
  return { orgId, userId: user.id };
}

export async function cleanup(orgIds: string[], userIds: string[]) {
  await purgeOrganizations(admin, orgIds);
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
}
