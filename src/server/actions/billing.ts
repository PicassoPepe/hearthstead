"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { requirePermission } from "@/server/context";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import { audit } from "@/server/audit";
import { billingConfigured } from "@/server/billing/stripe-client";
import { billingPortal, startCheckout } from "@/server/billing/subscription";
import { isLocalInstall } from "@/server/license/local";

/** The app's public address, for Stripe's "come back here" links. */
async function appUrl() {
  if (process.env.AUTH_URL) return process.env.AUTH_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

const notReady = () => new UserFacingError("Online billing isn't switched on yet. Nothing has been charged.");

export async function startCheckoutAction(raw: { planKey: string; interval: "month" | "year" }): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    // Billing pages stay usable when the company is read-only for non-payment — that's how they fix it.
    const ctx = await requirePermission("settings", "edit", { billing: true });
    if (isLocalInstall() || !billingConfigured()) throw notReady();
    const v = z.object({ planKey: z.enum(["hosted_starter", "hosted_growth", "hosted_scale"]), interval: z.enum(["month", "year"]) }).parse(raw);
    const units = await ctx.db.unit.count({ where: { deletedAt: null, property: { deletedAt: null } } });
    const url = await startCheckout({ orgId: ctx.org.id, email: ctx.user.email, planKey: v.planKey, interval: v.interval, units, appUrl: await appUrl() });
    await audit(ctx.db, { action: "billing.checkout_started", entityType: "Organization", entityId: ctx.org.id, after: { ...v, units } });
    return { url };
  });
}

export async function openBillingPortalAction(): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const ctx = await requirePermission("settings", "edit", { billing: true });
    if (isLocalInstall() || !billingConfigured()) throw notReady();
    return { url: await billingPortal(ctx.org.id, await appUrl()) };
  });
}
