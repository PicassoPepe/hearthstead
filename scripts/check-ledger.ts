/** Verify ledger invariants for every org: entries balance, A/R == open charges, prepaid == unapplied. */
import { PrismaClient } from "@prisma/client";
import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";
import { createScopedClient } from "../src/server/dal";
import * as M from "../src/server/leasing/money";

if (existsSync(".env")) loadEnvFile(".env");
const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_ADMIN_URL } } });
const app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  let problems = 0;
  for (const o of await admin.organization.findMany()) {
    const db = createScopedClient(app, { orgId: o.id, userId: null });
    const entries = await db.journalEntry.findMany({ include: { lines: true } });
    for (const e of entries) {
      const dr = e.lines.reduce((s, l) => s + l.debitCents, 0);
      const cr = e.lines.reduce((s, l) => s + l.creditCents, 0);
      if (dr !== cr || dr === 0) {
        problems++;
        console.log(`UNBALANCED ${o.name} ${e.id} ${dr} ${cr}`);
      }
    }
    const leases = await db.lease.findMany({ select: { id: true, status: true } });
    let owed = 0;
    for (const l of leases) {
      await db.tx(async (tx) => {
        const b = await M.leaseBalance(tx, l.id);
        const open = (await M.openCharges(tx, l.id)).reduce((s, c) => s + c.remainingCents, 0);
        const un = (await M.unappliedSources(tx, l.id)).reduce((s, c) => s + c.unappliedCents, 0);
        if (b.receivableCents !== open || b.prepaidCents !== un) {
          problems++;
          console.log(`MISMATCH ${l.id}`, b, open, un);
        }
        if (b.balanceCents > 0) owed += b.balanceCents;
      });
    }
    const status = leases.reduce<Record<string, number>>((m, l) => ({ ...m, [l.status]: (m[l.status] ?? 0) + 1 }), {});
    if (leases.length) console.log(`${o.name}: ${entries.length} entries, leases ${JSON.stringify(status)}, owed $${(owed / 100).toFixed(2)}`);
  }
  console.log(problems ? `${problems} PROBLEMS` : "All ledger invariants hold.");
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
}

void main();
