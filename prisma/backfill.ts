/** Idempotent data backfills, run after every migration (pnpm db:migrate / pnpm dev). */
import { PrismaClient } from "@prisma/client";
import { provisionChart } from "../src/server/accounting/chart";

async function main(): Promise<void> {
  const db = new PrismaClient();
  // Phase 2: every organization gets the default chart of accounts.
  const orgs = await db.organization.findMany({ select: { id: true } });
  for (const o of orgs) await provisionChart(db, o.id);
  await db.$disconnect();
  console.log(`Backfill complete (${orgs.length} organizations checked).`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
