import { createNodePrisma } from "./node-client.mjs";
import type { TaskStatus } from "@prisma/client";
import { createScopedClient } from "../src/server/dal";
import { createTask, setTaskStatus, commentOnTask, updateTask } from "../src/server/maintenance/tasks";
import { saveVendor } from "../src/server/maintenance/vendors";
import { createBill } from "../src/server/maintenance/bills";
import { saveInspectionItem, summarizeInspection } from "../src/server/maintenance/inspections";
import { addDays, toISODate } from "../src/lib/dates";

/** Phase 5 demo data: vendors, auto-assign rules, ~25 tasks across every status, a bill and an inspection. */
export async function seedMaintenance(appUrl: string, orgId: string, users: Record<string, string>, today: Date) {
  const app = createNodePrisma(appUrl);
  const admin = users["admin@example.com"]!;
  const pm = users["pm@example.com"]!;
  const maint = users["maint@example.com"]!;
  const db = createScopedClient(app, { orgId, userId: admin });
  const staff = { userId: pm, name: "Priya Manager", kind: "STAFF" as const };

  const V = [
    { name: "Ace Plumbing", contactName: "Val Vendor", email: "vendor@example.com", phone: "(312) 555-0141", trades: ["PLUMBING"], w9OnFile: true, taxIdLast4: "4410", insuranceExpires: toISODate(addDays(today, 200)) },
    { name: "Bright Spark Electric", contactName: "Lena Ortiz", email: "dispatch@brightspark.example.com", phone: "(312) 555-0142", trades: ["ELECTRICAL"], w9OnFile: true, taxIdLast4: "7781", insuranceExpires: toISODate(addDays(today, 90)) },
    { name: "Polar Air HVAC", contactName: "Sam Brandt", email: "service@polarair.example.com", phone: "(773) 555-0143", trades: ["HVAC"], w9OnFile: true, taxIdLast4: "1209", insuranceExpires: toISODate(addDays(today, -12)) },
    { name: "Northside Appliance Repair", contactName: "Ike Park", email: "ike@northsideappliance.example.com", phone: "(773) 555-0144", trades: ["APPLIANCE"], w9OnFile: false, taxIdLast4: "", insuranceExpires: "" },
    { name: "Green Thumb Landscaping", contactName: "Rosa Diaz", email: "rosa@greenthumb.example.com", phone: "(847) 555-0145", trades: ["LANDSCAPING"], w9OnFile: true, taxIdLast4: "6623", insuranceExpires: toISODate(addDays(today, 300)) },
    { name: "Sparkle Clean Co.", contactName: "Mia Chen", email: "jobs@sparkleclean.example.com", phone: "(312) 555-0146", trades: ["CLEANING"], w9OnFile: true, taxIdLast4: "3390", insuranceExpires: toISODate(addDays(today, 150)) },
    { name: "Bug-Off Pest Control", contactName: "Tom Reyes", email: "service@bugoff.example.com", phone: "(708) 555-0147", trades: ["PEST"], w9OnFile: true, taxIdLast4: "8102", insuranceExpires: toISODate(addDays(today, 60)) },
    { name: "Lakeview Lock & Key", contactName: "Dev Shah", email: "dev@lakeviewlock.example.com", phone: "(773) 555-0148", trades: ["LOCKSMITH"], w9OnFile: false, taxIdLast4: "", insuranceExpires: "" },
  ];
  const vendorIds: Record<string, string> = {};
  for (const v of V) vendorIds[v.trades[0]!] = (await saveVendor(db, null, v)).id;
  await db.vendor.update({ where: { id: vendorIds.PLUMBING! }, data: { userId: users["vendor@example.com"]! } });

  await db.setting.create({
    data: {
      organizationId: orgId, scope: "ORG", scopeId: orgId, key: "maintenance.autoAssignRules",
      value: [
        { category: "PLUMBING", userId: pm, vendorId: vendorIds.PLUMBING! },
        { category: "ELECTRICAL", userId: maint, vendorId: vendorIds.ELECTRICAL! },
        { category: "HVAC", userId: maint, vendorId: vendorIds.HVAC! },
        { category: "GENERAL", userId: maint, vendorId: null },
      ],
    },
  });

  const leases = await db.lease.findMany({
    where: { status: { in: ["ACTIVE", "EVICTION"] } },
    include: { units: true, tenants: { where: { role: "PRIMARY" }, include: { tenant: true } }, property: true },
    orderBy: { startDate: "asc" },
  });
  const residential = leases.filter((l) => !l.property.type.startsWith("COMMERCIAL"));
  const demo = residential.find((l) => l.tenants[0]?.tenant.email === "tenant@example.com");

  type Spec = { lease?: (typeof leases)[number]; type: "TASK" | "TENANT_REQUEST" | "WORK_ORDER" | "OWNER_REQUEST"; title: string; category?: string; priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT"; status: TaskStatus; daysAgo: number; due?: number; vendor?: string; estimate?: number; description?: string; pte?: boolean; times?: string };
  const pick = (i: number) => residential[i % residential.length]!;
  const specs: Spec[] = [
    ...(demo ? [{ lease: demo, type: "TENANT_REQUEST" as const, title: "Bathroom sink drains slowly", category: "PLUMBING", status: "IN_PROGRESS" as TaskStatus, daysAgo: 3, description: "Water takes a few minutes to drain after brushing teeth.", pte: true, times: "Weekdays after 5pm" }] : []),
    { lease: pick(1), type: "TENANT_REQUEST", title: "No heat in bedroom", category: "HVAC", priority: "URGENT", status: "NOT_STARTED", daysAgo: 0, description: "Radiator in the back bedroom is cold since last night.", pte: true },
    { lease: pick(2), type: "TENANT_REQUEST", title: "Dishwasher not draining", category: "APPLIANCE", status: "WAITING", daysAgo: 6, vendor: "APPLIANCE", estimate: 18_500, description: "Standing water after every cycle.", pte: false, times: "Saturday mornings" },
    { lease: pick(3), type: "TENANT_REQUEST", title: "Outlet in kitchen sparks", category: "ELECTRICAL", priority: "HIGH", status: "IN_PROGRESS", daysAgo: 2, pte: true },
    { lease: pick(4), type: "TENANT_REQUEST", title: "Mice in pantry", category: "PEST", status: "NOT_STARTED", daysAgo: 1, vendor: "PEST", pte: true },
    { lease: pick(5), type: "TENANT_REQUEST", title: "Front door lock sticking", category: "LOCKSMITH", status: "COMPLETED", daysAgo: 20, vendor: "LOCKSMITH", estimate: 9_500 },
    { lease: pick(6), type: "TENANT_REQUEST", title: "Toilet runs constantly", category: "PLUMBING", status: "COMPLETED", daysAgo: 35, estimate: 22_000 },
    { lease: pick(7), type: "WORK_ORDER", title: "Replace water heater", category: "PLUMBING", priority: "HIGH", status: "COMPLETED", daysAgo: 28, vendor: "PLUMBING", estimate: 148_000 },
    { lease: pick(8), type: "WORK_ORDER", title: "Annual furnace service — whole building", category: "HVAC", status: "NOT_STARTED", daysAgo: 4, due: 10, vendor: "HVAC", estimate: 65_000 },
    { lease: pick(9), type: "WORK_ORDER", title: "Fall leaf cleanup", category: "LANDSCAPING", priority: "LOW", status: "IN_PROGRESS", daysAgo: 8, due: 5, vendor: "LANDSCAPING", estimate: 42_000 },
    { lease: pick(10), type: "WORK_ORDER", title: "Turnover clean before showing", category: "CLEANING", status: "NOT_STARTED", daysAgo: 1, due: 3, vendor: "CLEANING", estimate: 28_000 },
    { lease: pick(11), type: "WORK_ORDER", title: "Repair leaking roof flashing", category: "ROOFING", priority: "URGENT", status: "WAITING", daysAgo: 9, due: -2, estimate: 95_000, description: "Water stain spreading on top-floor ceiling." },
    { lease: pick(12), type: "TASK", title: "Test smoke and CO detectors", category: "GENERAL", status: "NOT_STARTED", daysAgo: 5, due: -1 },
    { lease: pick(13), type: "TASK", title: "Order replacement mailbox keys", category: "LOCKSMITH", priority: "LOW", status: "WAITING", daysAgo: 12 },
    { lease: pick(14), type: "TASK", title: "Renew boiler inspection certificate", status: "IN_PROGRESS", daysAgo: 15, due: 20 },
    { lease: pick(15), type: "OWNER_REQUEST", title: "Quote for new kitchen countertops", status: "NOT_STARTED", daysAgo: 6, due: 14, description: "Owner asked for 2–3 quotes before the next lease renewal." },
    { lease: pick(16), type: "TENANT_REQUEST", title: "Window screen torn", category: "GENERAL", priority: "LOW", status: "ARCHIVED", daysAgo: 60 },
    { lease: pick(17), type: "TENANT_REQUEST", title: "Hallway light out", category: "ELECTRICAL", status: "COMPLETED", daysAgo: 14 },
    { lease: pick(18), type: "TASK", title: "Snow removal contract — confirm schedule", category: "LANDSCAPING", status: "COMPLETED", daysAgo: 25 },
    { lease: pick(19), type: "TENANT_REQUEST", title: "Garbage disposal jammed", category: "APPLIANCE", status: "NOT_STARTED", daysAgo: 0, pte: true, times: "Anytime" },
  ];

  let created = 0;
  for (const s of specs) {
    const l = s.lease;
    const t = await createTask(db, {
      type: s.type, title: s.title, category: s.category ?? null, priority: s.priority ?? "NORMAL", description: s.description ?? "",
      propertyId: l?.propertyId ?? null, unitId: l?.units[0]?.unitId ?? null, leaseId: s.type === "TENANT_REQUEST" ? (l?.id ?? null) : null,
      tenantId: s.type === "TENANT_REQUEST" ? (l?.tenants[0]?.tenantId ?? null) : null,
      vendorId: s.vendor ? vendorIds[s.vendor] : null, estimateCents: s.estimate ?? null,
      dueDate: s.due != null ? toISODate(addDays(today, s.due)) : "", permissionToEnter: s.pte ?? null, preferredTimes: s.times ?? null, notifyVendor: false,
    }, s.type === "TENANT_REQUEST" && l?.tenants[0] ? { userId: null, name: `${l.tenants[0].tenant.firstName ?? ""} ${l.tenants[0].tenant.lastName ?? ""}`.trim() || "Tenant", kind: "TENANT" } : staff);
    if (s.status === "IN_PROGRESS" || s.status === "WAITING" || s.status === "COMPLETED") await setTaskStatus(db, t.id, "IN_PROGRESS", staff);
    if (s.status === "IN_PROGRESS" && s.type === "TENANT_REQUEST") await commentOnTask(db, t.id, "Thanks for letting us know — a technician is scheduled for tomorrow between 9 and 11am.", true, staff);
    if (s.status !== "NOT_STARTED" && s.status !== "IN_PROGRESS") await setTaskStatus(db, t.id, s.status, staff);
    await db.task.update({ where: { id: t.id }, data: { createdAt: addDays(today, -s.daysAgo) } });
    created++;
    if (s.title === "Replace water heater") {
      const repairs = (await db.account.findFirstOrThrow({ where: { systemKey: "REPAIRS" } })).id;
      await createBill(db, { vendorId: vendorIds.PLUMBING!, billNumber: "ACE-2291", billDate: toISODate(addDays(today, -21)), dueDate: toISODate(addDays(today, 9)), taskId: t.id, memo: `Work order #${t.number}: ${s.title}`, lines: [{ accountId: repairs, amountCents: 151_250, description: s.title, propertyId: l?.propertyId ?? null, unitId: l?.units[0]?.unitId ?? null }] }, staff);
    }
  }

  // Subtasks on a turnover project.
  const turnover = await createTask(db, { type: "TASK", title: "Turn over Maple Court · 302", propertyId: residential[0]!.propertyId, priority: "HIGH", dueDate: toISODate(addDays(today, 7)) }, staff);
  for (const [i, title] of ["Patch & paint", "Replace carpet in bedroom", "Deep clean", "Re-key locks"].entries()) {
    const sub = await createTask(db, { type: "TASK", title, propertyId: residential[0]!.propertyId, parentTaskId: turnover.id }, staff);
    if (i === 0) await setTaskStatus(db, sub.id, "COMPLETED", staff);
  }
  await updateTask(db, turnover.id, { assigneeIds: [maint] }, staff);

  // A completed move-out inspection with ratings and an AI summary.
  const ended = await db.lease.findFirst({ where: { status: "ENDED" }, include: { units: true } });
  if (ended) {
    const insp = await createTask(db, { type: "INSPECTION", title: "Move-out inspection", unitId: ended.units[0]!.unitId, inspectionKind: "MOVE_OUT", assigneeIds: [maint] }, staff);
    const items = await db.inspectionItem.findMany({ where: { taskId: insp.id }, orderBy: { sortOrder: "asc" } });
    const ratings: Record<string, [string, string?]> = {
      "Walls & paint": ["FAIR", "Nail holes in living room"], "Floors": ["GOOD"], "Range / oven": ["POOR", "Oven heavily soiled"], "Refrigerator": ["GOOD"],
      "Tub / shower": ["GOOD"], "Floors / carpet": ["DAMAGED", "Pet stain near closet"], "Windows & blinds": ["FAIR", "Two slats bent"],
    };
    for (const i of items) {
      const r = ratings[i.item] ?? ["GOOD"];
      await saveInspectionItem(db, i.id, { condition: r[0], note: r[1] ?? null });
    }
    await summarizeInspection(db, insp.id, staff);
    await setTaskStatus(db, insp.id, "COMPLETED", staff);
    created++;
  }
  await app.$disconnect();
  return { vendors: V.length, tasks: created };
}
