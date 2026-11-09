import { adminDb } from "@/server/db";
import { DEFAULT_PLANS } from "@/lib/pricing";

export type PublicPlan = (typeof DEFAULT_PLANS)[number] & { active?: boolean; published?: boolean };

/**
 * Plans for the marketing pages: the live catalog when the database answers quickly, otherwise
 * the accepted default prices (so the static website export works without a database).
 */
export async function publicPlans(): Promise<PublicPlan[]> {
  if (process.env.MARKETING_STATIC === "1" && !process.env.DATABASE_URL) return DEFAULT_PLANS;
  const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
  const rows = await Promise.race([adminDb.plan.findMany({ where: { active: true, published: true }, orderBy: { sortOrder: "asc" } }).catch(() => null), timeout]);
  return rows && rows.length ? (rows as unknown as PublicPlan[]) : DEFAULT_PLANS;
}
