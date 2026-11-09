import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import * as S from "@/server/site/service";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { siteSchema, newBlock } from "@/lib/site/blocks";
import { admin, app, cleanup, makeOrg } from "./helpers";

let A: { orgId: string; userId: string };
let B: { orgId: string; userId: string };
let a: ScopedDb;
let b: ScopedDb;
let slugA: string;

async function listing(db: ScopedDb, orgId: string, title: string) {
  const p = await createPropertyFromWizard(db, { type: "SINGLE_FAMILY", name: title, address: { addressLine1: "1 Web St", city: "Louisville", state: "KY", postalCode: "40202" }, units: [{ name: "Main", marketRentCents: 120_000 }], owners: [] });
  const u = await db.unit.findFirstOrThrow({ where: { propertyId: p.id } });
  await db.listing.create({ data: { organizationId: orgId, unitId: u.id, propertyId: p.id, title, slug: `${title.toLowerCase().replace(/\W+/g, "-")}-${Date.now()}`, rentCents: 120_000, status: "PUBLISHED" } });
}

beforeAll(async () => {
  A = await makeOrg("SITEA");
  B = await makeOrg("SITEB");
  a = createScopedClient(app, { orgId: A.orgId, userId: A.userId });
  b = createScopedClient(app, { orgId: B.orgId, userId: B.userId });
  slugA = (await admin.organization.findUniqueOrThrow({ where: { id: A.orgId } })).slug;
  await listing(a, A.orgId, "Alpha House");
  await listing(b, B.orgId, "Beta House");
});
afterAll(async () => {
  await cleanup([A.orgId, B.orgId], [A.userId, B.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("company websites", () => {
  it("draft → publish → only published content and only this company's homes are public", async () => {
    const w = await S.getWebsite(a);
    expect(await S.publicSite(slugA)).toBeNull(); // nothing published yet
    expect((await S.publicSite(slugA, { draft: true }))?.site.title).toBeTruthy(); // staff preview works
    await expect(S.saveDraft(a, { title: "x", theme: { primary: "nope" } })).rejects.toThrow();
    const c = siteSchema.parse(w.draft);
    c.title = "Alpha Homes";
    await S.saveDraft(a, c);
    const v1 = await S.publish(a, "First");
    const pub = (await S.publicSite(slugA))!;
    expect(pub.site.title).toBe("Alpha Homes");
    expect(pub.listings.map((l) => l.title)).toEqual(["Alpha House"]); // Beta's listing never shows (RLS)
    // A draft change isn't public until published again.
    await S.saveDraft(a, { ...c, title: "Alpha Homes 2", sections: [...c.sections.map((s) => (s.type === "vacancies" ? { ...s, enabled: false } : s)), newBlock("faq")] });
    expect((await S.publicSite(slugA))!.site.title).toBe("Alpha Homes");
    await S.publish(a);
    expect((await S.publicSite(slugA))!.site.title).toBe("Alpha Homes 2");
    // Restore the first version.
    await S.restoreVersion(a, v1.id);
    expect((await S.publicSite(slugA))!.site.title).toBe("Alpha Homes");
    expect(await a.websiteVersion.count()).toBe(3);
    expect(await a.auditLog.count({ where: { action: { in: ["website.published", "website.rolled_back"] } } })).toBe(3);
    // Hidden site → not public, content kept.
    await S.setLive(a, false);
    expect(await S.publicSite(slugA)).toBeNull();
    await S.setLive(a, true);
  });

  it("templates replace only the draft", async () => {
    await S.applyTemplate(a, "luxury");
    expect((await S.publicSite(slugA))!.site.title).toBe("Alpha Homes");
    await expect(S.applyTemplate(a, "bogus")).rejects.toThrow(/Pick a design/);
  });

  it("custom domains: validated, unique, and looked up", async () => {
    await expect(S.setCustomDomain(a, "not a domain")).rejects.toThrow(/www\./);
    const d = `www.alpha-${Date.now()}.com`;
    await S.setCustomDomain(a, `https://${d}/`);
    expect(await S.slugForDomain(d)).toBe(slugA);
    await S.getWebsite(b);
    await expect(S.setCustomDomain(b, d)).rejects.toThrow(/already uses/);
    await S.setCustomDomain(a, null);
    expect(await S.slugForDomain(d)).toBeNull();
  });

  it("website messages land in People interested (and repeat visitors are merged)", async () => {
    await expect(S.receiveWebsiteMessage(slugA, { kind: "contact", name: "Sam", email: "", phone: "", message: "Hi" })).rejects.toThrow(/email or phone/);
    const id = await S.receiveWebsiteMessage(slugA, { kind: "contact", name: "Sam Seeker", email: "Sam@Example.com", phone: "", message: "Is the house pet friendly?" });
    const again = await S.receiveWebsiteMessage(slugA, { kind: "tour", name: "Sam Seeker", email: "sam@example.com", phone: "", message: "Can I see it?", when: "Saturday" });
    expect(again).toBe(id);
    const p = await a.prospect.findFirstOrThrow({ where: { id } });
    expect(p).toMatchObject({ firstName: "Sam", lastName: "Seeker", source: "WEBSITE" });
    expect(p.notes).toMatch(/pet friendly[\s\S]*tour request \(Saturday\)/);
  });
});
