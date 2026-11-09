/* Applies prisma/rls.sql using the owner connection. Run after every migration.
 *
 * Local / desktop: if deedwood_app does not exist yet, the script creates it with the
 * development password in prisma/rls.sql.
 *
 * Production Neon (GitHub Actions, or any DATABASE_ADMIN_URL on *.neon.tech): the role
 * deedwood_app already exists with its own password. This script must not CREATE that role
 * and must not ALTER its password. The pooled URL in DATABASE_URL is the only place that
 * password lives.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

export const LOCAL_APP_PASSWORD = "deedwood_app";

/** True when this connection is the hosted Neon database, not a laptop or Railway Postgres. */
export function isNeonHost(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return url.includes(".neon.tech");
  }
}

export function productionRls(env: Record<string, string | undefined> = process.env): boolean {
  return env.DEEDWOOD_RLS_MODE === "production" || isNeonHost(env.DATABASE_ADMIN_URL);
}

/** Split rls.sql on statement boundaries, keeping $$ blocks intact. */
export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let buf = "";
  let inDollar = false;
  for (const line of sql.split("\n")) {
    if (line.trim().startsWith("--") && !inDollar) continue;
    buf += line + "\n";
    const count = (line.match(/\$\$/g) ?? []).length;
    if (count % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trim().endsWith(";")) {
      statements.push(buf.trim());
      buf = "";
    }
  }
  return statements;
}

/** Production drops the CREATE ROLE statement so the local password can never be applied. */
export function statementsFor(sql: string, production: boolean): string[] {
  const statements = splitSql(sql);
  if (!production) return statements;
  return statements.filter((s) => !/CREATE\s+ROLE\s+deedwood_app\b/i.test(s));
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  const production = productionRls();
  const sql = readFileSync(join(__dirname, "rls.sql"), "utf8");
  const statements = statementsFor(sql, production);
  if (production && statements.some((s) => /PASSWORD\s+'deedwood_app'/i.test(s))) {
    throw new Error("Refusing to run a statement that sets the local deedwood_app password.");
  }
  for (const s of statements) await db.$executeRawUnsafe(s);

  if (production) {
    const rows = await db.$queryRaw<{ ok: number }[]>`SELECT 1 AS ok FROM pg_roles WHERE rolname = 'deedwood_app'`;
    if (!rows.length) {
      throw new Error("deedwood_app is missing. Production deploy will not create it and will not set the local password. Create the role in Neon first.");
    }
    if (process.env.APP_DB_PASSWORD) {
      console.log("APP_DB_PASSWORD is set and was ignored. Production does not change the deedwood_app password.");
    }
    await db.$disconnect();
    console.log(`RLS applied (${statements.length} statements). deedwood_app password was not changed.`);
    return;
  }

  // Railway's start script sets a generated password. Never accept the local default here.
  const pw = process.env.APP_DB_PASSWORD;
  if (pw) {
    if (pw === LOCAL_APP_PASSWORD) throw new Error("Refusing to set deedwood_app's password to the local default.");
    if (!/^[A-Za-z0-9_-]{16,}$/.test(pw)) throw new Error("APP_DB_PASSWORD must be 16+ letters, digits, - or _");
    await db.$executeRawUnsafe(`ALTER ROLE deedwood_app PASSWORD '${pw}'`);
  }
  await db.$disconnect();
  console.log(`RLS applied (${statements.length} statements).`);
}

const entry = process.argv[1]?.replace(/\\/g, "/");
if (entry?.endsWith("prisma/apply-rls.ts") || entry?.endsWith("prisma/apply-rls.js")) {
  main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(msg.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://<redacted>"));
    process.exit(1);
  });
}
