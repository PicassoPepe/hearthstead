/* Applies prisma/rls.sql using the owner connection. Run after every migration. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";

async function main(): Promise<void> {
  const db = new PrismaClient();
  const sql = readFileSync(join(__dirname, "rls.sql"), "utf8");
  // Split on statement boundaries outside of $$ blocks.
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
  for (const s of statements) await db.$executeRawUnsafe(s);
  await db.$disconnect();
  console.log(`RLS applied (${statements.length} statements).`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
