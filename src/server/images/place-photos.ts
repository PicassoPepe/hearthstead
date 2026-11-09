import type { ScopedDb } from "@/server/dal";
import { UserFacingError } from "@/server/action-result";
import { audit } from "@/server/audit";
import { geocode } from "@/adapters/parcels";
import { addPhotos, imageUrl } from "./service";

/**
 * Pictures of a property from its address:
 * - Aerial: USGS National Map NAIP imagery — U.S. government, public domain, free, nationwide.
 *   Saved as a normal property photo.
 * - Street View: Google's street-level picture of the front of the building. Needs
 *   GOOGLE_MAPS_API_KEY. Google's terms don't allow keeping copies, so it is never stored:
 *   /api/street-view/[propertyId] fetches it live (the key stays on the server).
 * - Zillow has no way to share listing photos with other apps, so we link to it instead.
 */
type Fetcher = (url: string) => Promise<Response>;
let fetcher: Fetcher = (url) => fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "DeedWood/1.0 (property management)" } });
export function setPlaceFetcher(f: Fetcher) { fetcher = f; }

const NAIP = "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage";

type Addr = { addressLine1: string; city: string; state: string; postalCode: string };
const oneLine = (p: Addr) => `${p.addressLine1}, ${p.city}, ${p.state} ${p.postalCode}`;

async function property(db: ScopedDb, id: string) {
  const p = await db.property.findFirst({ where: { id }, include: { parcelRecord: { select: { latitude: true, longitude: true } } } });
  if (!p) throw new UserFacingError("Property not found");
  return p;
}

/** Where the building is: the land record's point if we have one, else the Census geocoder. */
export async function locate(db: ScopedDb, id: string) {
  const p = await property(db, id);
  if (p.parcelRecord?.latitude != null && p.parcelRecord.longitude != null) return { latitude: p.parcelRecord.latitude, longitude: p.parcelRecord.longitude };
  const g = await geocode(p).catch(() => null);
  if (!g) throw new UserFacingError("We couldn't find that address on the map. Check the address, or upload a photo instead.");
  return { latitude: g.latitude, longitude: g.longitude };
}

/** A bounding box about `widthM` metres wide around a point (4:3). */
export function boxAround(lat: number, lon: number, widthM = 170) {
  const dLon = widthM / 2 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dLat = (widthM * 0.75) / 2 / 110_540;
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((n) => n.toFixed(6)).join(",");
}

/** Download the aerial picture of the property and add it to its photos. Returns the new photo id. */
export async function addAerialPhoto(db: ScopedDb, id: string, opts: { cover?: boolean } = {}) {
  const pt = await locate(db, id);
  const q = new URLSearchParams({ bbox: boxAround(pt.latitude, pt.longitude), bboxSR: "4326", imageSR: "3857", size: "800,600", format: "jpg", f: "image" });
  let res: Response;
  try {
    res = await fetcher(`${NAIP}?${q}`);
  } catch {
    throw new UserFacingError("The aerial-photo service didn't answer. Try again in a minute.");
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new UserFacingError("There's no aerial photo for this address (they cover the United States only).");
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 2_000) throw new UserFacingError("There's no aerial photo for this address.");
  const [photoId] = await addPhotos(db, { kind: "property", id }, [new File([bytes], "aerial-view.jpg", { type: "image/jpeg" })]);
  if (opts.cover) {
    const p = await property(db, id);
    const photos = [photoId!, ...p.photos.filter((x) => x !== photoId)];
    await db.property.update({ where: { id }, data: { photos, streetViewCover: false, photoUrl: imageUrl(photoId!) } });
  }
  await audit(db, { action: "photos.aerial_added", entityType: "Property", entityId: id });
  return photoId!;
}

export const streetViewEnabled = () => Boolean(process.env.GOOGLE_MAPS_API_KEY);
export const streetViewPath = (propertyId: string) => `/api/street-view/${propertyId}`;
const key = () => process.env.GOOGLE_MAPS_API_KEY ?? "";

/** Does Google have a street-level picture of this address? (The metadata check is free.) */
export async function streetViewAvailable(p: Addr) {
  if (!streetViewEnabled()) return false;
  const res = await fetcher(`https://maps.googleapis.com/maps/api/streetview/metadata?${new URLSearchParams({ location: oneLine(p), source: "outdoor", key: key() })}`).catch(() => null);
  if (!res?.ok) return false;
  const body = (await res.json().catch(() => ({}))) as { status?: string };
  return body.status === "OK";
}

/** The picture itself (for the proxy route). */
export async function streetViewImage(p: Addr, size = "800x600") {
  if (!streetViewEnabled()) return null;
  const res = await fetcher(`https://maps.googleapis.com/maps/api/streetview?${new URLSearchParams({ location: oneLine(p), size, source: "outdoor", return_error_code: "true", key: key() })}`).catch(() => null);
  if (!res?.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) return null;
  return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type")! };
}

/** Use (or stop using) the Street View picture as the property's main picture. */
export async function setStreetViewCover(db: ScopedDb, id: string, on: boolean) {
  const p = await property(db, id);
  if (on) {
    if (!streetViewEnabled()) throw new UserFacingError("Street View isn't set up. Add a Google Maps key in the .env file (see the README).");
    if (!(await streetViewAvailable(p))) throw new UserFacingError("Google doesn't have a street picture of this address.");
  }
  await db.property.update({ where: { id }, data: { streetViewCover: on, photoUrl: on ? streetViewPath(id) : p.photos[0] ? imageUrl(p.photos[0]) : null } });
  await audit(db, { action: on ? "photos.street_view_on" : "photos.street_view_off", entityType: "Property", entityId: id });
}
