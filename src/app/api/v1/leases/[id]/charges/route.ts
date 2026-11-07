import { apiRoute, notFound, readJson } from "@/server/api/core";
import * as X from "@/server/api/serialize";
import { CreateCharge } from "@/server/api/schemas";
import { postCharge } from "@/server/leasing/money";
import { AccountResolver } from "@/server/ledger/journal";
import { audit } from "@/server/audit";
import { parseISODate, toISODate } from "@/lib/dates";

/** Posts a charge through the same ledger service the app uses (Dr A/R, Cr income). */
export const POST = apiRoute({ write: true }, async ({ db, orgId }, req, { id }) => {
  const v = await readJson(req, CreateCharge);
  if (!(await db.lease.findFirst({ where: { id } }))) throw notFound("Lease");
  const t = await db.tx(async (tx) => {
    const accountId = await new AccountResolver(tx).id(v.account);
    const date = parseISODate(v.date ?? toISODate(new Date()));
    return postCharge(tx, { orgId, userId: null }, { leaseId: id, accountId, amountCents: v.amount, date, memo: v.memo ?? "Charge (API)", chargeKind: v.account === "RENT_INCOME" ? "RENT" : v.account === "LATE_FEE_INCOME" ? "LATE_FEE" : "OTHER" });
  });
  await audit(db, { action: "lease.charge_posted", entityType: "Lease", entityId: id, actorType: "API", after: v });
  return { status: 201, body: X.transaction(t) };
});
