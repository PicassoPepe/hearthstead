import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedClient, type ScopedDb } from "@/server/dal";
import { createPropertyFromWizard } from "@/server/rentals/service";
import { addAerialPhoto, boxAround, setPlaceFetcher, setStreetViewCover, streetViewImage } from "@/server/images/place-photos";
import { setPhotos } from "@/server/images/service";
import { setParcelFetcher } from "@/adapters/parcels";
import { admin, app, cleanup, makeOrg } from "./helpers";

let O: { orgId: string; userId: string };
let db: ScopedDb;
let propertyId: string;
const JPEG = new Uint8Array(5_000).fill(7);
const seen: string[] = [];

beforeAll(async () => {
  O = await makeOrg("PLACE");
  db = createScopedClient(app, { orgId: O.orgId, userId: O.userId });
  propertyId = (await createPropertyFromWizard(db, { type: "SINGLE_FAMILY", name: "Main St House", address: { addressLine1: "55 N Main St", city: "Monticello", state: "KY", postalCode: "42633" }, units: [{ name: "Main", marketRentCents: 90_000 }], owners: [] })).id;
  setParcelFetcher(async () => new Response(JSON.stringify({ result: { addressMatches: [{ matchedAddress: "55 N MAIN ST", coordinates: { x: -84.8483, y: 36.8307 } }] } }), { headers: { "content-type": "application/json" } }));
  setPlaceFetcher(async (url) => {
    seen.push(url);
    if (url.includes("imagery.nationalmap.gov")) return url.includes("bbox=-1") ? new Response("{\"error\":{}}", { headers: { "content-type": "application/json" } }) : new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    if (url.includes("streetview/metadata")) return new Response(JSON.stringify({ status: "OK" }), { headers: { "content-type": "application/json" } });
    if (url.includes("maps/api/streetview")) return new Response(JPEG, { headers: { "content-type": "image/jpeg" } });
    return new Response("nope", { status: 404 });
  });
});
afterAll(async () => {
  delete process.env.GOOGLE_MAPS_API_KEY;
  await cleanup([O.orgId], [O.userId]);
  await Promise.all([admin.$disconnect(), app.$disconnect()]);
});

describe("property pictures", () => {
  it("builds a small box around the point", () => {
    const [w, s, e, n] = boxAround(36.83, -84.85, 170).split(",").map(Number);
    expect(e! - w!).toBeCloseTo(170 / (111_320 * Math.cos((36.83 * Math.PI) / 180)), 5);
    expect(n! - s!).toBeGreaterThan(0);
  });

  it("adds a free aerial photo as the main picture", async () => {
    const id = await addAerialPhoto(db, propertyId, { cover: true });
    const p = await db.property.findFirstOrThrow({ where: { id: propertyId } });
    expect(p.photos[0]).toBe(id);
    expect(p.photoUrl).toBe(`/api/images/${id}`);
    expect(seen.some((u) => u.includes("USGSNAIPImagery") && u.includes("bboxSR=4326"))).toBe(true);
  });

  it("Street View needs a Google key, is used live as the main picture, and a photo can take over again", async () => {
    await expect(setStreetViewCover(db, propertyId, true)).rejects.toThrow(/Google Maps key/);
    process.env.GOOGLE_MAPS_API_KEY = "test-key";
    await setStreetViewCover(db, propertyId, true);
    let p = await db.property.findFirstOrThrow({ where: { id: propertyId } });
    expect(p.photoUrl).toBe(`/api/street-view/${propertyId}`);
    expect((await streetViewImage(p))?.type).toBe("image/jpeg");
    // Reordering keeps Street View as the main picture…
    await setPhotos(db, { kind: "property", id: propertyId }, p.photos);
    expect((await db.property.findFirstOrThrow({ where: { id: propertyId } })).photoUrl).toBe(`/api/street-view/${propertyId}`);
    // …until a photo is picked as the main picture.
    await setPhotos(db, { kind: "property", id: propertyId }, p.photos, true);
    p = await db.property.findFirstOrThrow({ where: { id: propertyId } });
    expect(p.streetViewCover).toBe(false);
    expect(p.photoUrl).toBe(`/api/images/${p.photos[0]}`);
  });
});
