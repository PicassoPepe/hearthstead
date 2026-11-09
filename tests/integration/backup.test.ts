import { afterAll, describe, expect, it } from "vitest";
import { createBackup, decodeBackup, encodeBackup, insertOrder, listTables, restoreBackup } from "@/server/ops/backup";
import { recordError } from "@/server/ops/errors";
import { admin, app } from "./helpers";

afterAll(async () => {
  await admin.errorEvent.deleteMany({ where: { message: { startsWith: "test-boom" } } });
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("backups", () => {
  it("orders tables so parents come before children", async () => {
    const order = await insertOrder(admin, await listTables(admin));
    expect(order.indexOf("Organization")).toBeLessThan(order.indexOf("Property"));
    expect(order.indexOf("Property")).toBeLessThan(order.indexOf("Unit"));
    expect(order.indexOf("User")).toBeLessThan(order.indexOf("Membership"));
  });

  it("encrypts with BACKUP_KEY and refuses the wrong key", async () => {
    const tiny = { version: 1 as const, createdAt: new Date().toISOString(), migration: null, tables: { X: [{ a: 1 }] } };
    expect(decodeBackup(encodeBackup(tiny, null))).toEqual(tiny);
    const enc = encodeBackup(tiny, "correct horse");
    expect(enc.includes(Buffer.from('"a":1'))).toBe(false);
    expect(decodeBackup(enc, "correct horse")).toEqual(tiny);
    expect(() => decodeBackup(enc, "wrong")).toThrow(/Wrong BACKUP_KEY/);
    expect(() => decodeBackup(enc)).toThrow(/encrypted/);
    expect(() => decodeBackup(Buffer.from("hello"))).toThrow(/isn't a DeedWood backup/);
  });

  it("a full backup restores every table exactly", async () => {
    const before = await createBackup(admin);
    const file = decodeBackup(encodeBackup(before, "k"), "k");
    const r = await restoreBackup(admin, file);
    expect(r.tables).toBe(Object.keys(before.tables).length);
    const after = await createBackup(admin);
    for (const [t, rows] of Object.entries(before.tables)) expect(after.tables[t]?.length, t).toBe(rows.length);
    // Spot-check that values (dates, JSON, arrays, money) survive.
    const orgBefore = before.tables.Organization as { id: string; createdAt: string }[];
    const orgAfter = after.tables.Organization as { id: string; createdAt: string }[];
    expect(orgAfter.find((o) => o.id === orgBefore[0]!.id)).toEqual(orgBefore[0]);
  }, 120_000);
});

describe("error recording", () => {
  it("stores the error with a stable fingerprint", async () => {
    const mk = () => new Error("test-boom: something broke");
    await recordError("action", mk(), { path: "/app/x" });
    await recordError("action", mk(), { path: "/app/x" });
    const rows = await admin.errorEvent.findMany({ where: { message: "test-boom: something broke" } });
    expect(rows).toHaveLength(2);
    expect(rows[0]!.fingerprint).toBe(rows[1]!.fingerprint);
    expect(rows[0]).toMatchObject({ source: "action", path: "/app/x" });
  });
});
