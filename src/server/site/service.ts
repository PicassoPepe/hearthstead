import type { ScopedDb } from "@/server/dal";
import { adminDb } from "@/server/db";
import { forOrg } from "@/server/dal/for-org";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { notifyModule } from "@/server/notifications/service";
import { photoUrls } from "@/server/images/service";
import { parseSite, siteSchema, type SiteContent } from "@/lib/site/blocks";
import { templateContent, TEMPLATES, type TemplateKey } from "@/lib/site/templates";

/**
 * Company websites: staff edit a draft, publish it (every publish is kept as a version that can
 * be restored), and visitors see the published copy at /s/<company web name> or the company's
 * own domain. Nothing about the site is ever deleted by switching sections or the site off.
 */
export async function getWebsite(db: ScopedDb) {
  const w = await db.website.findFirst({});
  if (w) return w;
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId } });
  return db.website.create({ data: { organizationId: db.ctx.orgId, draft: templateContent("apartments", org) as object, template: "apartments", createdById: db.ctx.userId } });
}

export async function saveDraft(db: ScopedDb, content: unknown) {
  const c = parseSite(content);
  const w = await getWebsite(db);
  await db.website.update({ where: { id: w.id }, data: { draft: c as object } });
  return c;
}

export async function applyTemplate(db: ScopedDb, key: string) {
  if (!(key in TEMPLATES)) throw new UserFacingError("Pick a design");
  const org = await adminDb.organization.findUniqueOrThrow({ where: { id: db.ctx.orgId } });
  const w = await getWebsite(db);
  const c = templateContent(key as TemplateKey, org);
  await db.website.update({ where: { id: w.id }, data: { draft: c as object, template: key } });
  await audit(db, { action: "website.template_applied", entityType: "Website", entityId: w.id, after: { template: key } });
  return c;
}

export async function publish(db: ScopedDb, note?: string) {
  const w = await getWebsite(db);
  const c = parseSite(w.draft);
  if (!c.title.trim()) throw new UserFacingError("Give your website a name before publishing", { title: "Required" });
  const now = new Date();
  await db.website.update({ where: { id: w.id }, data: { published: c as object, publishedAt: now } });
  const v = await db.websiteVersion.create({ data: { organizationId: db.ctx.orgId, content: c as object, note: note?.trim().slice(0, 200) || null, publishedAt: now, publishedById: db.ctx.userId } });
  await audit(db, { action: "website.published", entityType: "Website", entityId: w.id, after: { versionId: v.id, sections: c.sections.filter((s) => s.enabled).length } });
  return v;
}

/** Put a past version back — both live and in the editor. */
export async function restoreVersion(db: ScopedDb, versionId: string) {
  const v = await db.websiteVersion.findFirst({ where: { id: versionId } });
  if (!v) throw new UserFacingError("That version wasn't found");
  const w = await getWebsite(db);
  const c = parseSite(v.content);
  const now = new Date();
  await db.website.update({ where: { id: w.id }, data: { draft: c as object, published: c as object, publishedAt: now } });
  await db.websiteVersion.create({ data: { organizationId: db.ctx.orgId, content: c as object, note: `Restored the version from ${v.publishedAt.toISOString().slice(0, 10)}`, publishedAt: now, publishedById: db.ctx.userId } });
  await audit(db, { action: "website.rolled_back", entityType: "Website", entityId: w.id, after: { fromVersion: versionId } });
}

export async function setLive(db: ScopedDb, live: boolean) {
  const w = await getWebsite(db);
  await db.website.update({ where: { id: w.id }, data: { live } });
  await audit(db, { action: live ? "website.turned_on" : "website.turned_off", entityType: "Website", entityId: w.id });
}

const HOST = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
export async function setCustomDomain(db: ScopedDb, domain: string | null) {
  const w = await getWebsite(db);
  const d = domain?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
  if (d && !HOST.test(d)) throw new UserFacingError("Enter a domain like www.yourcompany.com", { domain: "Invalid" });
  const root = process.env.SITES_ROOT_DOMAIN?.toLowerCase();
  if (d && root && (d === root || d.endsWith(`.${root}`))) throw new UserFacingError("Use your own domain here — the DeedWood address works automatically.", { domain: "Invalid" });
  if (d && (await adminDb.website.findFirst({ where: { customDomain: d, NOT: { id: w.id } } }))) throw new UserFacingError("Another company already uses that domain", { domain: "Taken" });
  await db.website.update({ where: { id: w.id }, data: { customDomain: d } });
  await audit(db, { action: "website.domain_set", entityType: "Website", entityId: w.id, after: { domain: d } });
}

// ─── Public side ───────────────────────────────────────────────────────────────

/** Org web name for a custom domain (used by the middleware's host lookup). */
export async function slugForDomain(host: string) {
  const w = await adminDb.website.findFirst({ where: { customDomain: host.toLowerCase(), live: true }, select: { organizationId: true } });
  if (!w) return null;
  const o = await adminDb.organization.findFirst({ where: { id: w.organizationId, deletedAt: null, suspendedAt: null }, select: { slug: true } });
  return o?.slug ?? null;
}

/** Everything a visitor's page needs. `draft` = staff preview of unpublished changes. */
export async function publicSite(orgSlug: string, opts: { draft?: boolean } = {}) {
  const org = await adminDb.organization.findFirst({ where: { slug: orgSlug, deletedAt: null, suspendedAt: null } });
  if (!org) return null;
  const db = forOrg({ orgId: org.id, userId: null });
  const w = await db.website.findFirst({});
  const raw = opts.draft ? (w?.draft ?? templateContent("apartments", org)) : w?.live ? w.published : null;
  if (!raw) return null;
  const site: SiteContent = siteSchema.parse(raw);
  const on = (t: string) => site.sections.some((s) => s.enabled && s.type === t);
  const [listings, galleryProps] = await Promise.all([
    on("vacancies") || on("apply") || on("hero") ? db.listing.findMany({ where: { status: "PUBLISHED", deletedAt: null }, orderBy: [{ availableOn: "asc" }, { rentCents: "asc" }], take: 60 }) : Promise.resolve([]),
    on("gallery") ? db.property.findMany({ where: { deletedAt: null, photos: { isEmpty: false } }, select: { photos: true, name: true }, take: 12 }) : Promise.resolve([]),
  ]);
  const units = listings.length ? await db.unit.findMany({ where: { id: { in: listings.map((l) => l.unitId) } }, include: { property: true } }) : [];
  return {
    org: { id: org.id, name: org.name, slug: org.slug, phone: org.phone, email: org.email, logoUrl: org.logoUrl, city: org.city, state: org.state, addressLine1: org.addressLine1, postalCode: org.postalCode },
    site,
    updatedAt: w?.publishedAt ?? null,
    listings: listings.map((l) => {
      const u = units.find((x) => x.id === l.unitId);
      return { id: l.id, slug: l.slug, title: l.title, rentCents: l.rentCents, availableOn: l.availableOn, beds: u?.beds ?? null, bathsTenths: u?.bathsTenths ?? null, sqft: u?.sqft ?? null, address: u ? `${u.property.addressLine1}, ${u.property.city}` : "", photo: u ? photoUrls(u.photos, u.property.photos)[0] ?? null : null };
    }),
    propertyPhotos: galleryProps.flatMap((p) => p.photos.slice(0, 3).map((id) => ({ url: `/api/images/${id}`, alt: p.name }))).slice(0, 12),
  };
}

/** Contact form / tour request from the website → People interested + a bell notification. */
export async function receiveWebsiteMessage(orgSlug: string, v: { kind: "contact" | "tour"; name: string; email: string; phone: string; message: string; when?: string }) {
  const org = await adminDb.organization.findFirst({ where: { slug: orgSlug, deletedAt: null, suspendedAt: null } });
  if (!org) throw new UserFacingError("This website isn't available");
  const db = forOrg({ orgId: org.id, userId: null });
  const [firstName, ...rest] = v.name.trim().split(/\s+/);
  if (!firstName) throw new UserFacingError("Enter your name", { name: "Required" });
  if (!v.email.trim() && !v.phone.trim()) throw new UserFacingError("Add an email or phone so they can reply", { email: "Email or phone" });
  const stamp = new Date().toISOString().slice(0, 10);
  const note = `${stamp} website ${v.kind === "tour" ? `tour request${v.when ? ` (${v.when})` : ""}` : "message"}: ${v.message.trim()}`.slice(0, 2000);
  const email = v.email.trim().toLowerCase() || null;
  const existing = email ? await db.prospect.findFirst({ where: { email } }) : null;
  const p = existing
    ? await db.prospect.update({ where: { id: existing.id }, data: { notes: [existing.notes, note].filter(Boolean).join("\n").slice(-5000), status: existing.status === "LOST" ? "NEW" : existing.status } })
    : await db.prospect.create({ data: { organizationId: org.id, firstName: firstName.slice(0, 60), lastName: (rest.join(" ") || "—").slice(0, 60), email, phone: v.phone.trim() || null, source: "WEBSITE", notes: note } });
  await notifyModule(db, "leasing", { kind: "website.message", title: v.kind === "tour" ? `Tour request from ${v.name.trim()}` : `Website message from ${v.name.trim()}`, body: v.message.trim().slice(0, 200), href: "/app/people/prospects" });
  return p.id;
}
