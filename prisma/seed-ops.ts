import { PrismaClient } from "@prisma/client";
import { createScopedClient } from "../src/server/dal";
import { assignKeyItem, saveKeyItem, returnKeyItem } from "../src/server/rentals/keys";
import { toISODate } from "../src/lib/dates";

/** Daily-operations demo data: keys, fobs, parking and storage at Maple Court. */
export async function seedOps(appUrl: string, orgId: string, adminId: string, today: Date) {
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  const db = createScopedClient(app, { orgId, userId: adminId });
  const maple = await db.property.findFirstOrThrow({ where: { name: "Maple Court" } });
  const leases = await db.lease.findMany({ where: { propertyId: maple.id, status: "ACTIVE" }, orderBy: { startDate: "asc" }, take: 4 });
  const units = await db.unit.findMany({ where: { propertyId: maple.id }, orderBy: { name: "asc" } });
  const day = toISODate(today);
  let n = 0;
  const add = async (kind: "KEY" | "FOB" | "PARKING" | "STORAGE" | "MAILBOX", label: string, extra: { unitId?: string; fee?: number; assignTo?: string; bill?: boolean } = {}) => {
    const { id } = await saveKeyItem(db, null, { kind, label, propertyId: maple.id, unitId: extra.unitId ?? null, monthlyFeeCents: extra.fee ?? 0 });
    if (extra.assignTo) await assignKeyItem(db, id, { leaseId: extra.assignTo, date: day, billFee: extra.bill ?? false });
    n++;
    return id;
  };
  for (let i = 1; i <= 6; i++) await add("PARKING", `P${i}`, { fee: 7_500, assignTo: leases[i - 1]?.id, bill: false });
  await add("STORAGE", "Locker B1", { fee: 3_500, assignTo: leases[0]?.id, bill: false });
  await add("STORAGE", "Locker B2", { fee: 3_500 });
  for (const [i, u] of units.slice(0, 4).entries()) {
    await add("KEY", `${u.name} front door`, { unitId: u.id, assignTo: leases[i]?.id });
    await add("MAILBOX", `Mailbox ${u.name}`, { unitId: u.id, assignTo: leases[i]?.id });
  }
  const lostFob = await add("FOB", "Lobby fob #14", { assignTo: leases[1]?.id });
  await returnKeyItem(db, lostFob, { date: day, lost: true });
  await add("FOB", "Lobby fob #15");
  await app.$disconnect();
  return { keys: n };
}
