import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { emit } from "@/server/platform/events";
import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { getEmailProvider } from "@/adapters";
import { getPaymentsProvider, PaymentDeclinedError } from "@/adapters/payments";
import { getScreeningProvider, type ScreeningResult } from "@/adapters/screening";
import { postEntry } from "@/server/ledger/journal";
import { getSettings } from "@/server/settings/service";
import { renderTemplate, DEFAULT_TEMPLATES } from "@/lib/templates";
import { parseISODate, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

/** Step data, saved as the applicant goes (autosave). Every field optional until submit. */
export const applicationDataSchema = z.object({
  about: z.object({ firstName: z.string().max(60), lastName: z.string().max(60), phone: z.string().max(30), dob: z.string().max(10), ssnLast4: z.string().max(4), desiredMoveIn: z.string().max(10) }).partial().default({}),
  residence: z.object({ currentAddress: z.string().max(200), monthsAtAddress: z.string().max(4), currentRent: z.string().max(12), landlordName: z.string().max(80), landlordPhone: z.string().max(30), reasonForMoving: z.string().max(300) }).partial().default({}),
  employment: z.object({ employer: z.string().max(100), title: z.string().max(80), monthsEmployed: z.string().max(4), monthlyIncome: z.string().max(12), otherIncome: z.string().max(12) }).partial().default({}),
  more: z.object({ occupants: z.string().max(3), pets: z.string().max(200), vehicles: z.string().max(200), reference: z.string().max(200), evicted: z.enum(["", "no", "yes"]), notes: z.string().max(500) }).partial().default({}),
});
export type ApplicationData = z.infer<typeof applicationDataSchema>;

export const APPLICATION_STEPS = ["About you", "Where you live now", "Work & income", "A few more questions", "Review & pay"] as const;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
const cents = (s: string | undefined) => {
  const n = Number((s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Start (or resume by email) an application for a published listing. Returns the raw resume token. */
export async function startApplication(db: ScopedDb, listingId: string, email: string) {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new UserFacingError("Enter a valid email", { email: "Enter a valid email" });
  const listing = await db.listing.findFirst({ where: { id: listingId, status: "PUBLISHED" } });
  if (!listing) throw new UserFacingError("This listing is no longer available");
  const token = randomBytes(24).toString("base64url");
  const fee = (await getSettings(db, ["applications.feeCents"], { orgId: db.ctx.orgId, propertyId: listing.propertyId }))["applications.feeCents"].value;
  const existing = await db.application.findFirst({ where: { email: e, listingId, status: "DRAFT" } });
  if (existing) {
    await db.application.update({ where: { id: existing.id }, data: { tokenHash: hashToken(token) } });
    return { id: existing.id, token, resumed: true };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const last = await db.application.findFirst({ orderBy: { number: "desc" }, select: { number: true } });
    try {
      const a = await db.application.create({ data: { organizationId: db.ctx.orgId, number: (last?.number ?? 2000) + 1, listingId, propertyId: listing.propertyId, unitId: listing.unitId, email: e, feeCents: fee, tokenHash: hashToken(token) } });
      return { id: a.id, token, resumed: false };
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
    }
  }
  throw new UserFacingError("Please try again");
}

/** Resolve an application from the applicant's token (cookie). */
export async function applicationByToken(db: ScopedDb, token: string | undefined) {
  if (!token) return null;
  return db.application.findFirst({ where: { tokenHash: hashToken(token) } });
}

/** Autosave a step. Drafts only; validation is light until submit. */
export async function saveApplicationStep(db: ScopedDb, id: string, step: number, raw: unknown) {
  const a = await db.application.findFirst({ where: { id } });
  if (!a) throw new UserFacingError("Application not found");
  if (a.status !== "DRAFT") throw new UserFacingError("This application was already submitted");
  const merged = applicationDataSchema.parse({ ...(a.data as object), ...(raw as object) });
  await db.application.update({
    where: { id },
    data: {
      // Only move forward once the previous step is complete, so a resume never skips required fields.
      data: merged, step: step > a.step && Object.keys(stepErrors(step - 1, merged)).length === 0 ? Math.min(step, APPLICATION_STEPS.length - 1) : a.step, lastSavedAt: new Date(),
      firstName: merged.about.firstName ?? a.firstName, lastName: merged.about.lastName ?? a.lastName, phone: merged.about.phone ?? a.phone,
      desiredMoveIn: merged.about.desiredMoveIn && /^\d{4}-\d{2}-\d{2}$/.test(merged.about.desiredMoveIn) ? parseISODate(merged.about.desiredMoveIn) : a.desiredMoveIn,
    },
  });
  return merged;
}

/** Per-step required fields, checked on Next and again at submit. */
export function stepErrors(step: number, d: ApplicationData): Record<string, string> {
  const e: Record<string, string> = {};
  const req = (cond: boolean, k: string, msg: string) => { if (!cond) e[k] = msg; };
  if (step === 0) {
    req(!!d.about.firstName?.trim(), "about.firstName", "Enter your first name");
    req(!!d.about.lastName?.trim(), "about.lastName", "Enter your last name");
    req(/^\d{10,}$/.test((d.about.phone ?? "").replace(/\D/g, "")), "about.phone", "Enter a phone number");
    req(/^\d{4}-\d{2}-\d{2}$/.test(d.about.dob ?? ""), "about.dob", "Enter your date of birth");
    req(/^\d{4}$/.test(d.about.ssnLast4 ?? ""), "about.ssnLast4", "Enter the last 4 digits of your SSN");
  }
  if (step === 1) {
    req(!!d.residence.currentAddress?.trim(), "residence.currentAddress", "Enter your current address");
    req(/^\d+$/.test(d.residence.monthsAtAddress ?? ""), "residence.monthsAtAddress", "How many months have you lived there?");
  }
  if (step === 2) {
    req(!!d.employment.employer?.trim(), "employment.employer", "Enter your employer (or \"Self-employed\" / \"Student\")");
    req(cents(d.employment.monthlyIncome) > 0, "employment.monthlyIncome", "Enter your monthly income before taxes");
  }
  if (step === 3) req(d.more.evicted === "no" || d.more.evicted === "yes", "more.evicted", "Answer the eviction question");
  return e;
}

/** Pay the application fee by card (mock: 4242… succeeds, …0002 declines) and post it to the ledger. */
export async function payApplicationFee(db: ScopedDb, id: string, card: { number: string; expMonth: number; expYear: number; cvc: string }) {
  const a = await db.application.findFirst({ where: { id } });
  if (!a) throw new UserFacingError("Application not found");
  if (a.feePaidAt || a.feeCents === 0) return a;
  const account = await db.processorAccount.findFirst({});
  if (!account?.chargesEnabled) throw new UserFacingError("Online payments aren't set up yet. Contact the office to pay the fee.");
  const provider = getPaymentsProvider();
  let ref: string;
  try {
    const method = await provider.addCard(card);
    const r = await provider.charge({ connectedAccount: account.externalId, methodType: "CARD", methodRef: method.providerRef, totalCents: a.feeCents, feeCents: 0, idempotencyKey: `appfee-${a.id}`, description: `Application fee #${a.number}` });
    if (r.status === "FAILED") throw new UserFacingError(r.failureReason ?? "Card declined");
    ref = r.providerRef;
  } catch (e) {
    if (e instanceof PaymentDeclinedError) throw new UserFacingError(e.message);
    throw e;
  }
  const updated = await db.tx(async (tx) => {
    const je = await postEntry(tx, db.ctx.orgId, null, {
      date: new Date(), memo: `Application fee #${a.number} — ${a.firstName} ${a.lastName}`.trim(), source: "APPLICATION_FEE", sourceId: a.id,
      lines: [
        { account: { key: "UNDEPOSITED_FUNDS" }, debitCents: a.feeCents, creditCents: 0, propertyId: a.propertyId },
        { account: { key: "APPLICATION_FEE_INCOME" }, debitCents: 0, creditCents: a.feeCents, propertyId: a.propertyId },
      ],
    });
    return tx.application.update({ where: { id }, data: { feePaidAt: new Date(), feeReference: ref, feeJournalEntryId: je.id } });
  });
  await audit(db, { action: "application.fee_paid", entityType: "Application", entityId: id, actorType: "SYSTEM", after: { feeCents: a.feeCents } });
  return updated;
}

/** Submit: validate every step, record consent, run screening, notify staff. */
export async function submitApplication(db: ScopedDb, id: string, consent: { ip: string | null }) {
  const a = await db.application.findFirst({ where: { id } });
  if (!a) throw new UserFacingError("Application not found");
  if (a.status !== "DRAFT") throw new UserFacingError("Already submitted");
  const d = applicationDataSchema.parse(a.data);
  for (let s = 0; s < 4; s++) {
    const errs = stepErrors(s, d);
    if (Object.keys(errs).length) throw new UserFacingError(`Please finish "${APPLICATION_STEPS[s]}" first`, errs);
  }
  if (a.feeCents > 0 && !a.feePaidAt) throw new UserFacingError("Pay the application fee to submit");
  await db.application.update({ where: { id }, data: { status: "SCREENING", submittedAt: new Date(), consentAt: new Date(), consentIp: consent.ip } });
  const listing = a.listingId ? await db.listing.findFirst({ where: { id: a.listingId } }) : null;
  const result = await getScreeningProvider().screen({
    firstName: d.about.firstName ?? "", lastName: d.about.lastName ?? "", email: a.email, dob: d.about.dob, ssnLast4: d.about.ssnLast4,
    monthlyIncomeCents: cents(d.employment.monthlyIncome) + cents(d.employment.otherIncome), rentCents: listing?.rentCents ?? 0,
  });
  await db.application.update({ where: { id }, data: { status: "SUBMITTED", screening: result as unknown as object, screenedAt: new Date() } });
  // Link (or create) the prospect so the funnel shows them as applied.
  const prospect = (await db.prospect.findFirst({ where: { email: a.email } })) ?? (await db.prospect.create({ data: { organizationId: db.ctx.orgId, firstName: d.about.firstName ?? "", lastName: d.about.lastName ?? "", email: a.email, phone: d.about.phone ?? null, source: "WEBSITE", listingId: a.listingId } }));
  await db.prospect.update({ where: { id: prospect.id }, data: { status: "APPLIED" } });
  await db.application.update({ where: { id }, data: { prospectId: prospect.id } });
  const org = await db.organization.findFirst({ where: { id: db.ctx.orgId } });
  await getEmailProvider().send({ to: a.email, organizationId: db.ctx.orgId, subject: `We received your application #${a.number}`, text: `Thanks for applying${listing ? ` for ${listing.title}` : ""}. ${org?.name ?? "We"} will review it and get back to you soon.`, html: `<p style="font-family:system-ui,sans-serif">Thanks for applying${listing ? ` for <strong>${listing.title}</strong>` : ""}. ${org?.name ?? "We"} will review it and get back to you soon.</p>` });
  await audit(db, { action: "application.submitted", entityType: "Application", entityId: id, actorType: "SYSTEM", after: { recommendation: result.recommendation } });
  await emit(db, "application.submitted", { applicationId: id, number: a.number, email: a.email, firstName: d.about.firstName ?? "", lastName: d.about.lastName ?? "", propertyId: a.propertyId, unitId: a.unitId, listingId: a.listingId, recommendation: result.recommendation });
  return result;
}

export async function approveApplication(db: ScopedDb, id: string) {
  const a = await db.application.findFirst({ where: { id } });
  if (!a) throw new UserFacingError("Application not found");
  if (!["SUBMITTED", "SCREENING"].includes(a.status)) throw new UserFacingError("Only submitted applications can be approved");
  await db.application.update({ where: { id }, data: { status: "APPROVED", decidedAt: new Date(), decidedById: db.ctx.userId } });
  const org = await db.organization.findFirst({ where: { id: db.ctx.orgId } });
  await getEmailProvider().send({ to: a.email, organizationId: db.ctx.orgId, subject: `Your application #${a.number} is approved`, text: `Good news — ${org?.name} approved your application. We'll send your lease to sign shortly.`, html: `<p style="font-family:system-ui,sans-serif">Good news — <strong>${org?.name}</strong> approved your application. We'll send your lease to sign shortly.</p>` });
  await audit(db, { action: "application.approved", entityType: "Application", entityId: id });
}

/** Decline with an FCRA-style adverse action notice built from the template. */
export async function declineApplication(db: ScopedDb, id: string, reasons: string) {
  const a = await db.application.findFirst({ where: { id } });
  if (!a) throw new UserFacingError("Application not found");
  if (!["SUBMITTED", "SCREENING", "APPROVED"].includes(a.status)) throw new UserFacingError("This application can't be declined");
  if (reasons.trim().length < 5) throw new UserFacingError("Give the reason(s) — they're included in the adverse action notice", { reasons: "Required" });
  const [org, property, unit, tmpl] = await Promise.all([
    db.organization.findFirstOrThrow({ where: { id: db.ctx.orgId } }),
    db.property.findFirst({ where: { id: a.propertyId } }),
    a.unitId ? db.unit.findFirst({ where: { id: a.unitId } }) : null,
    db.documentTemplate.findFirst({ where: { kind: "ADVERSE_ACTION" }, orderBy: { isDefault: "desc" } }),
  ]);
  const s = a.screening as ScreeningResult | null;
  const { html } = renderTemplate(tmpl?.body ?? DEFAULT_TEMPLATES.find((t) => t.kind === "ADVERSE_ACTION")!.body, {
    "applicant.name": `${a.firstName} ${a.lastName}`.trim(), "property.name": property?.name ?? "", "unit.name": unit ? `, Unit ${unit.name}` : "",
    "decision.reasons": reasons.trim(), "screening.provider": s ? `${s.provider === "mock" ? "Mock Screening Co." : s.provider} (report ${s.reportId})` : "our screening provider",
    "company.name": org.name, "company.phone": org.phone ?? "", today: formatDate(new Date()),
  });
  await db.application.update({ where: { id }, data: { status: "DECLINED", decisionReason: reasons.trim(), decidedAt: new Date(), decidedById: db.ctx.userId } });
  await getEmailProvider().send({ to: a.email, organizationId: db.ctx.orgId, subject: "Notice of adverse action — your rental application", html: `<div style="font-family:system-ui,sans-serif;max-width:640px">${html}</div>`, text: html.replace(/<[^>]+>/g, "") });
  await db.prospect.updateMany({ where: { email: a.email }, data: { status: "LOST" } });
  await audit(db, { action: "application.declined", entityType: "Application", entityId: id, after: { reasons } });
}

/** Lease-wizard preset from an approved application. */
export async function leasePresetFromApplication(db: ScopedDb, id: string) {
  const a = await db.application.findFirst({ where: { id } });
  if (!a || a.status !== "APPROVED") return null;
  const d = applicationDataSchema.parse(a.data);
  const listing = a.listingId ? await db.listing.findFirst({ where: { id: a.listingId } }) : null;
  return {
    applicationId: a.id, propertyId: a.propertyId, unitId: a.unitId ?? undefined,
    tenant: { firstName: d.about.firstName ?? a.firstName, lastName: d.about.lastName ?? a.lastName, email: a.email, phone: d.about.phone ?? "" },
    rentCents: listing?.rentCents ?? null, depositCents: listing?.depositCents ?? null,
    startDate: a.desiredMoveIn ? a.desiredMoveIn.toISOString().slice(0, 10) : null, termMonths: listing?.leaseTermMonths ?? 12,
  };
}

export const incomeOf = (d: ApplicationData) => cents(d.employment.monthlyIncome) + cents(d.employment.otherIncome);
export { formatMoney };
