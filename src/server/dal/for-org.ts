import "server-only";
import { appDb } from "@/server/db";
import { createScopedClient, type OrgContext, type ScopedDb } from "./index";

/** The only way request code should obtain a database handle. */
export function forOrg(ctx: OrgContext): ScopedDb {
  return createScopedClient(appDb, ctx);
}
