import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isNeonHost, productionRls, statementsFor } from "../../prisma/apply-rls";

const sql = readFileSync(join(__dirname, "../../prisma/rls.sql"), "utf8");

describe("production RLS does not touch the deedwood_app password", () => {
  it("drops only the local CREATE ROLE statement", () => {
    const local = statementsFor(sql, false);
    const prod = statementsFor(sql, true);
    expect(local.some((s) => /CREATE\s+ROLE\s+deedwood_app/i.test(s))).toBe(true);
    expect(local.some((s) => /PASSWORD\s+'deedwood_app'/i.test(s))).toBe(true);
    expect(prod.some((s) => /CREATE\s+ROLE\s+deedwood_app/i.test(s))).toBe(false);
    expect(prod.some((s) => /PASSWORD\s+'deedwood_app'/i.test(s))).toBe(false);
    expect(prod.some((s) => s.includes('GRANT USAGE ON SCHEMA public TO deedwood_app'))).toBe(true);
    expect(prod.length).toBe(local.length - 1);
  });

  it("treats Neon and the production flag as production, and localhost as local", () => {
    expect(isNeonHost("postgresql://deedwood_owner:secret@ep-example.us-east-2.aws.neon.tech/deedwood?sslmode=require")).toBe(true);
    expect(isNeonHost("postgresql://postgres:postgres@localhost:5432/deedwood")).toBe(false);
    expect(productionRls({ DEEDWOOD_RLS_MODE: "production" })).toBe(true);
    expect(productionRls({ DATABASE_ADMIN_URL: "postgresql://deedwood_owner:secret@ep-example.us-east-2.aws.neon.tech/deedwood" })).toBe(true);
    expect(productionRls({ DATABASE_ADMIN_URL: "postgresql://postgres:postgres@localhost:5432/deedwood" })).toBe(false);
  });
});
