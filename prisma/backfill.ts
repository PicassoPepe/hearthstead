/** Idempotent data backfills, run after every migration (pnpm db:migrate / pnpm dev). */
import { createNodePrisma } from "./node-client.mjs";
import { provisionChart } from "../src/server/accounting/chart";
import { ensurePlanCatalog } from "../src/server/billing/catalog";

async function main(): Promise<void> {
  const db = createNodePrisma();
  // Phase 2: every organization gets the default chart of accounts.
  const orgs = await db.organization.findMany({ select: { id: true } });
  for (const o of orgs) await provisionChart(db, o.id);
  // DeedWood's plan catalog (adds missing plans only — prices edited in /admin are kept).
  const added = await ensurePlanCatalog(db);
  if (added) console.log(`Plan catalog: added ${added} plan(s).`);
  await db.$disconnect();
  console.log(`Backfill complete (${orgs.length} organizations checked).`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
