import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { createTask, setTaskStatus, taskVisibility, updateTask, commentOnTask } from "@/server/maintenance/tasks";
import { saveVendor } from "@/server/maintenance/vendors";
import { createBill } from "@/server/maintenance/bills";
import { saveInspectionItem, summarizeInspection } from "@/server/maintenance/inspections";
import { setSetting } from "@/server/settings/service";
import { INSPECTION_TEMPLATE } from "@/lib/maintenance";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let B: { orgId: string; userId: string };
let db: ScopedDb;
let propertyId: string;
let unitId: string;
let vendorId: string;
const staff = () => ({ userId: A.userId, name: "Staff", kind: "STAFF" as const });

beforeAll(async () => {
  A = await makeOrg("MA");
  B = await makeOrg("MB");
  db = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
  propertyId = (await createPropertyFromWizard(db, { type: "MULTI_FAMILY", name: "Fix Flats", address: { addressLine1: "1 Fix St", city: "Chicago", state: "IL", postalCode: "60601" }, units: [{ name: "1", marketRentCents: 1 }, { name: "2", marketRentCents: 1 }], owners: [] })).id;
  unitId = (await db.unit.findFirstOrThrow({ where: { propertyId, name: "1" } })).id;
  vendorId = (await saveVendor(db, null, { name: "Ace Plumbing", email: "ace@example.com", trades: ["PLUMBING"] })).id;
});
afterAll(async () => {
  await cleanup([A.orgId, B.orgId], [A.userId, B.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("tasks", () => {
  it("numbers tasks per org and derives the property from the unit", async () => {
    const a = await createTask(db, { title: "Replace hallway bulb", unitId }, staff());
    const b = await createTask(db, { title: "Check smoke detectors", propertyId }, staff());
    expect(b.number).toBe(a.number + 1);
    expect((await db.task.findFirstOrThrow({ where: { id: a.id } })).propertyId).toBe(propertyId);
  });

  it("auto-assign rules route a category to a vendor and a staff member; the vendor is emailed", async () => {
    await setSetting(db, "maintenance.autoAssignRules", "ORG", A.orgId, [{ category: "PLUMBING", userId: A.userId, vendorId }]);
    const t = await createTask(db, { type: "TENANT_REQUEST", title: "Kitchen sink leaking", category: "PLUMBING", unitId, notifyVendor: true }, staff());
    const task = await db.task.findFirstOrThrow({ where: { id: t.id }, include: { assignees: true, activities: true } });
    expect(task.vendorId).toBe(vendorId);
    expect(task.assignees.map((a) => a.userId)).toEqual([A.userId]);
    expect(task.activities.some((x) => /auto-assigned/.test(x.body))).toBe(true);
    const mail = await admin.emailMessage.findFirst({ where: { to: "ace@example.com", subject: { contains: `#${t.number}` } } });
    expect(mail).not.toBeNull();
  });

  it("can't complete a task with open subtasks; status changes are logged", async () => {
    const parent = await createTask(db, { title: "Turn over unit 2", propertyId }, staff());
    const sub = await createTask(db, { title: "Paint", propertyId, parentTaskId: parent.id }, staff());
    await expect(setTaskStatus(db, parent.id, "COMPLETED", staff())).rejects.toThrow(/open subtask/);
    await setTaskStatus(db, sub.id, "COMPLETED", staff());
    await setTaskStatus(db, parent.id, "COMPLETED", staff());
    const acts = await db.taskActivity.findMany({ where: { taskId: parent.id, kind: "STATUS" } });
    expect(acts.map((a) => a.body)).toContain("Status: Not started → Completed");
  });

  it("rejects links to another org's records", async () => {
    const dbB = createScopedClient(app, { orgId: B.orgId, userId: B.userId });
    await expect(createTask(dbB, { title: "Sneaky", unitId }, { userId: B.userId, name: "B", kind: "STAFF" })).rejects.toThrow(/valid unit/);
    await expect(createTask(dbB, { title: "Sneaky", vendorId }, { userId: B.userId, name: "B", kind: "STAFF" })).rejects.toThrow(/valid vendor/);
  });

  it("vendors only see tasks assigned to their vendor record", async () => {
    const vendorUser = await admin.user.create({ data: { email: `v-${Date.now()}@example.com` } });
    await db.vendor.update({ where: { id: vendorId }, data: { userId: vendorUser.id } });
    const wo = await createTask(db, { type: "WORK_ORDER", title: "Fix toilet", unitId, vendorId }, staff());
    await createTask(db, { type: "TASK", title: "Internal only", propertyId }, staff());
    const where = await taskVisibility(db, { userId: vendorUser.id, roleKey: "VENDOR", propertyScope: [] });
    const visible = await db.task.findMany({ where });
    expect(visible.map((t) => t.id)).toContain(wo.id);
    expect(visible.every((t) => t.vendorId === vendorId)).toBe(true);
    expect(visible.some((t) => t.title === "Internal only")).toBe(false);
    await admin.user.delete({ where: { id: vendorUser.id } });
  });

  it("assigning a vendor turns a task into a work order; public comments are tenant-visible", async () => {
    const t = await createTask(db, { title: "Gutter clog", propertyId }, staff());
    await updateTask(db, t.id, { vendorId }, staff());
    expect((await db.task.findFirstOrThrow({ where: { id: t.id } })).type).toBe("WORK_ORDER");
    await commentOnTask(db, t.id, "Scheduled for Tuesday", true, staff());
    expect(await db.taskActivity.count({ where: { taskId: t.id, public: true, kind: "COMMENT" } })).toBe(1);
  });
});

describe("inspections", () => {
  it("creates the room-by-room checklist and an AI summary of problems", async () => {
    const t = await createTask(db, { type: "INSPECTION", title: "Move-out inspection", unitId, inspectionKind: "MOVE_OUT" }, staff());
    const items = await db.inspectionItem.findMany({ where: { taskId: t.id }, orderBy: { sortOrder: "asc" } });
    expect(items).toHaveLength(INSPECTION_TEMPLATE.reduce((s, r) => s + r.items.length, 0));
    await expect(summarizeInspection(db, t.id, staff())).rejects.toThrow(/Rate at least one/);
    await saveInspectionItem(db, items[0]!.id, { condition: "DAMAGED", note: "Deadbolt broken" });
    await saveInspectionItem(db, items[1]!.id, { condition: "GOOD" });
    const summary = await summarizeInspection(db, t.id, staff());
    expect(summary).toMatch(/Damaged: Entry & living room › Front door & locks/);
    expect(await db.auditLog.count({ where: { action: "ai.inspection_summary", entityId: t.id } })).toBe(1);
  });
});

describe("bills from vendor invoices", () => {
  it("posts Dr expense / Cr A/P, links to the work order once", async () => {
    const wo = await createTask(db, { type: "WORK_ORDER", title: "Water heater", unitId, vendorId }, staff());
    const repairs = (await db.account.findFirstOrThrow({ where: { systemKey: "REPAIRS" } })).id;
    const bill = await createBill(db, { vendorId, billNumber: "INV-77", billDate: "2026-11-05", dueDate: "2026-12-05", lines: [{ accountId: repairs, amountCents: 48_500, propertyId, unitId }], taskId: wo.id }, staff());
    const b = await db.bill.findFirstOrThrow({ where: { id: bill.id } });
    const lines = await db.journalLine.findMany({ where: { journalEntryId: b.journalEntryId! }, include: { account: true } });
    expect(lines.find((l) => l.account.systemKey === "REPAIRS")).toMatchObject({ debitCents: 48_500, propertyId });
    expect(lines.find((l) => l.account.systemKey === "ACCOUNTS_PAYABLE")).toMatchObject({ creditCents: 48_500 });
    expect((await db.task.findFirstOrThrow({ where: { id: wo.id } })).billId).toBe(bill.id);
    await expect(createBill(db, { vendorId, billDate: "2026-11-05", dueDate: "2026-12-05", lines: [{ accountId: repairs, amountCents: 1 }], taskId: wo.id })).rejects.toThrow(/already has a bill/);
    const rent = (await db.account.findFirstOrThrow({ where: { systemKey: "RENT_INCOME" } })).id;
    await expect(createBill(db, { vendorId, billDate: "2026-11-05", dueDate: "2026-12-05", lines: [{ accountId: rent, amountCents: 1 }] })).rejects.toThrow(/expense/);
  });
});
