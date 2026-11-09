"use server";

import { cookieOptions } from "@/lib/cookies";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import { runAction, UserFacingError, type ActionResult } from "@/server/action-result";
import * as A from "@/server/funnel/applications";
import * as E from "@/server/funnel/esign";
import * as L from "@/server/funnel/listings";

/** Public (no login) actions: applicant flow, showing requests, e-signing. Every lookup is by org slug + token. */
import { APPLY_COOKIE } from "@/lib/funnel";

async function orgDb(orgSlug: string) {
  const org = await adminDb.organization.findFirst({ where: { slug: orgSlug, deletedAt: null } });
  if (!org) throw new UserFacingError("Not found");
  return { org, db: forOrg({ orgId: org.id, userId: null }) };
}
async function meta() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null, ua: h.get("user-agent") };
}
async function myApplication(orgSlug: string) {
  const { db } = await orgDb(orgSlug);
  const a = await A.applicationByToken(db, (await cookies()).get(APPLY_COOKIE)?.value);
  if (!a) throw new UserFacingError("Your session expired — start again with the same email to resume.");
  return { db, a };
}

export async function startApplicationAction(orgSlug: string, listingSlug: string, email: string): Promise<ActionResult> {
  const r = await runAction(async () => {
    const { db } = await orgDb(orgSlug);
    const listing = await db.listing.findFirst({ where: { slug: listingSlug, status: "PUBLISHED" } });
    if (!listing) throw new UserFacingError("This home is no longer available");
    const s = await A.startApplication(db, listing.id, email);
    (await cookies()).set(APPLY_COOKIE, s.token, cookieOptions({ path: "/apply", maxAge: 60 * 60 * 24 * 30 }));
  });
  if (!r.ok) return r;
  redirect(`/apply/${orgSlug}/${listingSlug}/form`);
}

export async function saveApplicationStepAction(orgSlug: string, step: number, data: unknown): Promise<ActionResult<Record<string, string>>> {
  return runAction(async () => {
    const { db, a } = await myApplication(orgSlug);
    const merged = await A.saveApplicationStep(db, a.id, step, data);
    return A.stepErrors(step - 1, merged);
  });
}

/** `{ token }` from the secure Stripe card field; typed details only work with the test ("mock") processor. */
export async function payApplicationFeeAction(orgSlug: string, card: { number: string; exp: string; cvc: string } | { token: string }): Promise<ActionResult> {
  return runAction(async () => {
    const { db, a } = await myApplication(orgSlug);
    if ("token" in card) {
      if (!/^pm_[A-Za-z0-9]+$/.test(card.token)) throw new UserFacingError("The card couldn't be read. Please try again.");
      return void (await A.payApplicationFee(db, a.id, { token: card.token }));
    }
    const m = card.exp.match(/^(\d{2})\s*\/\s*(\d{2})$/);
    if (!m) throw new UserFacingError("Enter the expiry as MM/YY", { exp: "MM/YY" });
    await A.payApplicationFee(db, a.id, { number: card.number.replace(/\s/g, ""), expMonth: Number(m[1]), expYear: 2000 + Number(m[2]), cvc: card.cvc });
  }, "Fee paid");
}

export async function submitApplicationAction(orgSlug: string, listingSlug: string, consent: boolean): Promise<ActionResult> {
  const r = await runAction(async () => {
    if (!consent) throw new UserFacingError("Please confirm the authorization to continue", { consent: "Required" });
    const { db, a } = await myApplication(orgSlug);
    await A.submitApplication(db, a.id, { ip: (await meta()).ip });
  });
  if (!r.ok) return r;
  redirect(`/apply/${orgSlug}/${listingSlug}/done`);
}

const showingSchema = z.object({ firstName: z.string().trim().min(1, "Enter your first name").max(60), lastName: z.string().trim().min(1, "Enter your last name").max(60), email: z.string().email("Enter a valid email"), phone: z.string().max(30).optional(), startsAt: z.string().min(1, "Pick a time") });
export async function requestShowingAction(orgSlug: string, listingSlug: string, raw: z.input<typeof showingSchema>): Promise<ActionResult> {
  return runAction(async () => {
    const v = showingSchema.parse(raw);
    const { db } = await orgDb(orgSlug);
    const listing = await db.listing.findFirst({ where: { slug: listingSlug, status: "PUBLISHED" } });
    if (!listing) throw new UserFacingError("This home is no longer available");
    const p = await L.createProspect(db, { ...v, source: "WEBSITE", listingId: listing.id });
    await L.scheduleShowing(db, { listingId: listing.id, prospectId: p.id, startsAt: v.startsAt, source: "SELF_SCHEDULED" });
  }, "Showing booked — we'll see you then!");
}

export async function signAction(token: string, name: string, agree: boolean): Promise<ActionResult<{ completed: boolean }>> {
  return runAction(async () => {
    if (!agree) throw new UserFacingError("Please agree to sign electronically", { agree: "Required" });
    return E.signDocument(token, name, await meta());
  }, "Signed");
}

export async function declineSignAction(token: string, reason: string): Promise<ActionResult> {
  return runAction(async () => {
    await E.declineToSign(token, reason, await meta());
  }, "You declined to sign");
}

/** Primary applicant adds a co-applicant or guarantor (they get an email link to their own part). */
export async function addHouseholdMemberAction(orgSlug: string, listingSlug: string, v: { firstName: string; lastName: string; email: string; role: "CO_APPLICANT" | "GUARANTOR" }): Promise<ActionResult> {
  return runAction(async () => {
    const { db, a } = await myApplication(orgSlug);
    const h = await headers();
    const base = process.env.AUTH_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
    await A.addHouseholdMember(db, a.id, v, { base, orgSlug, listingSlug });
  }, `Invitation sent to ${v.email}`);
}

export async function removeHouseholdMemberAction(orgSlug: string, memberId: string): Promise<ActionResult> {
  return runAction(async () => {
    const { db, a } = await myApplication(orgSlug);
    await A.removeHouseholdMember(db, a.id, memberId);
  }, "Removed");
}
