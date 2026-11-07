import { apiRoute, notFound } from "@/server/api/core";
import { leaseBalance } from "@/server/leasing/money";

export const GET = apiRoute({}, async ({ db }, _req, { id }) => {
  if (!(await db.lease.findFirst({ where: { id } }))) throw notFound("Lease");
  const b = await db.tx((tx) => leaseBalance(tx, id));
  return { body: { object: "balance", lease_id: id, receivable: b.receivableCents, prepaid: b.prepaidCents, balance: b.balanceCents } };
});
