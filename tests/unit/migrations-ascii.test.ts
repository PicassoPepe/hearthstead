import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isSafeToRetry } from "../../prisma/recover-migrations";
import { withDatabase } from "../../prisma/convert-utf8";

const dir = join(__dirname, "../../prisma/migrations");

describe("database migrations", () => {
  // Older Windows installs use the WIN1252 character set, which rejects symbols like "→" — even
  // in SQL comments — and the whole update fails. Keep every migration plain ASCII.
  it.each(readdirSync(dir).filter((d) => !d.endsWith(".toml")))("%s is plain ASCII", (name) => {
    const sql = readFileSync(join(dir, name, "migration.sql"), "utf8");
    const bad = [...sql].map((c, i) => ({ c, i })).filter(({ c }) => c.charCodeAt(0) > 127);
    expect(bad.map(({ c, i }) => `${JSON.stringify(c)} at line ${sql.slice(0, i).split("\n").length}`)).toEqual([]);
  });
  it("only retries failures that left nothing half-done", () => {
    expect(isSafeToRetry({ migration_name: "20261114000000_scale_yearly_prices", logs: null })).toBe(true);
    expect(isSafeToRetry({ migration_name: "x", logs: 'character with byte sequence 0xe2 0x86 0x92 in encoding "UTF8" has no equivalent in encoding "WIN1252"' })).toBe(true);
    expect(isSafeToRetry({ migration_name: "x", logs: "column already exists" })).toBe(false);
  });
  it("points at another database on the same server", () => {
    expect(withDatabase("postgresql://postgres:postgres@localhost:54329/deedwood", "postgres")).toBe("postgresql://postgres:postgres@localhost:54329/postgres");
  });
});
