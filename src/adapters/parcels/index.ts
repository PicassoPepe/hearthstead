/**
 * Land records: find a property's parcel (outline, owner of record, deed reference, value).
 *
 * Lookup chain for PARCELS_PROVIDER=auto (default):
 *   1. Geocode the address with the free US Census geocoder (coordinates + county FIPS).
 *   2. If the county is in the registry (./counties) — query its public ArcGIS parcel layer (free).
 *   3. Else, if REGRID_TOKEN is set — Regrid's nationwide parcel API (paid, per record).
 *   4. Else — not available yet.
 * PARCELS_PROVIDER=mock returns deterministic sample parcels (demo data, tests, offline use).
 * PARCELS_PROVIDER=off disables lookups.
 */
import { countyByFips, type CountySource } from "./counties";

export type GeoJsonGeometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
export type ParcelLink = { label: string; url: string };
export type ParcelResult = {
  source: string;
  status: "LOOKED_UP" | "NOT_FOUND";
  latitude: number | null;
  longitude: number | null;
  countyFips: string | null;
  countyName: string | null;
  parcelId: string | null;
  ownerName: string | null;
  ownerMailing: string | null;
  situsAddress: string | null;
  legalDescription: string | null;
  acres: number | null;
  landUse: string | null;
  assessedValueCents: number | null;
  taxYear: number | null;
  lastSaleDate: string | null;
  lastSalePriceCents: number | null;
  deedBook: string | null;
  deedPage: string | null;
  geometry: GeoJsonGeometry | null;
  links: ParcelLink[];
  raw: Record<string, unknown> | null;
  message?: string;
};
export type ParcelQuery = { addressLine1: string; city: string; state: string; postalCode: string; ownerHint?: string | null };

type Fetcher = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;
let fetcher: Fetcher = (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000), headers: { "user-agent": "DeedWood/1.0 (property management)", ...(init?.headers ?? {}) } });
/** Tests swap the HTTP client. */
export function setParcelFetcher(f: Fetcher) { fetcher = f; }

const empty = (source: string, extra: Partial<ParcelResult> = {}): ParcelResult => ({
  source, status: "NOT_FOUND", latitude: null, longitude: null, countyFips: null, countyName: null, parcelId: null, ownerName: null, ownerMailing: null,
  situsAddress: null, legalDescription: null, acres: null, landUse: null, assessedValueCents: null, taxYear: null, lastSaleDate: null, lastSalePriceCents: null,
  deedBook: null, deedPage: null, geometry: null, links: [], raw: null, ...extra,
});

// ─── Geocoding (US Census, free) ──────────────────────────────────────────

export type Geocode = { latitude: number; longitude: number; countyFips: string | null; countyName: string | null; matchedAddress: string };

export async function geocode(q: ParcelQuery): Promise<Geocode | null> {
  const address = `${q.addressLine1}, ${q.city}, ${q.state} ${q.postalCode}`;
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`Geocoder returned ${res.status}`);
  const body = (await res.json()) as { result?: { addressMatches?: { matchedAddress: string; coordinates: { x: number; y: number }; geographies?: { Counties?: { GEOID: string; NAME: string; BASENAME?: string }[] } }[] } };
  const m = body.result?.addressMatches?.[0];
  if (!m) return null;
  const county = m.geographies?.Counties?.[0];
  return { latitude: m.coordinates.y, longitude: m.coordinates.x, countyFips: county?.GEOID ?? null, countyName: county ? `${county.NAME}, ${q.state.toUpperCase()}` : null, matchedAddress: m.matchedAddress };
}

// ─── Kentucky: rooftop points from the statewide 911 address layer ────────

const KY_911 = "https://kygisserver.ky.gov/arcgis/rest/services/WGS84WM_Services/Ky_911_Site_Structure_Address_Points_WGS84WM/MapServer/0";
const DIRS: Record<string, string> = { N: "NORTH", S: "SOUTH", E: "EAST", W: "WEST", NORTH: "NORTH", SOUTH: "SOUTH", EAST: "EAST", WEST: "WEST" };
const TYPES = new Set(["ST", "STREET", "AVE", "AVENUE", "RD", "ROAD", "DR", "DRIVE", "LN", "LANE", "CT", "COURT", "BLVD", "BOULEVARD", "HWY", "HIGHWAY", "PIKE", "PK", "WAY", "PL", "PLACE", "CIR", "CIRCLE", "TER", "TERRACE", "TRL", "TRAIL", "PKWY", "PARKWAY", "LOOP", "RUN", "ROW", "SQ"]);

/** "527 W Jefferson St" → { number: 527, name: "JEFFERSON" } (directions and street types dropped). */
export function parseStreet(line: string) {
  const parts = line.toUpperCase().replace(/[.,#]/g, " ").split(/\s+/).filter(Boolean);
  const number = Number(parts.shift());
  if (!Number.isInteger(number)) return null;
  const unit = parts.findIndex((w) => /^(APT|APARTMENT|UNIT|STE|SUITE|LOT|BLDG|FL)$/.test(w));
  if (unit > 0) parts.splice(unit);
  if (parts.length > 1 && DIRS[parts[0]!]) parts.shift();
  while (parts.length > 1 && (TYPES.has(parts.at(-1)!) || DIRS[parts.at(-1)!])) parts.pop();
  const name = parts.join(" ").replace(/'/g, "''");
  return name ? { number, name } : null;
}

/** Move a Census street-centerline point onto the building, using Kentucky's 911 site points (within ~2 km). */
async function refineKentucky(q: ParcelQuery, g: Geocode): Promise<Geocode> {
  const st = parseStreet(q.addressLine1);
  if (!st) return g;
  const where = `Add_Number=${st.number} AND UPPER(St_Name)='${st.name}'`;
  const res = await fetcher(`${KY_911}/query?${new URLSearchParams({ where, outFields: "Lat,Long,Post_Code", returnGeometry: "false", resultRecordCount: "20", f: "json" })}`).catch(() => null);
  if (!res?.ok) return g;
  const body = (await res.json()) as { features?: { attributes: { Lat: number; Long: number } }[] };
  const near = (body.features ?? []).map((f) => f.attributes).filter((a) => typeof a.Lat === "number" && typeof a.Long === "number")
    .map((a) => ({ ...a, d: Math.hypot((a.Lat - g.latitude) * 111, (a.Long - g.longitude) * 89) }))
    .filter((a) => a.d < 2).sort((x, y) => x.d - y.d)[0];
  return near ? { ...g, latitude: near.Lat, longitude: near.Long } : g;
}

// ─── Field mapping for county layers ──────────────────────────────────────

const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const cents = (v: unknown) => { const n = num(v); return n === null ? null : Math.round(n * 100); };
const date = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return new Date(v).toISOString().slice(0, 10); // ArcGIS epoch ms
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
};

/** Picks the first attribute whose name matches, in order of preference. */
function pick(attrs: Record<string, unknown>, patterns: RegExp[]) {
  const keys = Object.keys(attrs);
  for (const re of patterns) {
    const k = keys.find((x) => re.test(x));
    if (k !== undefined && str(attrs[k]) !== null) return attrs[k];
  }
  return null;
}

/** Map a county layer's attributes to DeedWood fields — explicit mapping first, then common names. */
export function mapAttributes(attrs: Record<string, unknown>, fields: CountySource["fields"] = {}) {
  const get = (key: keyof NonNullable<CountySource["fields"]>, patterns: RegExp[]) => (fields[key] ? attrs[fields[key]!] : pick(attrs, patterns));
  const owner = [get("owner", [/^own(er)?_?name1?$/i, /^owner1?$/i, /owner/i, /^name1?$/i]), fields.owner2 ? attrs[fields.owner2] : pick(attrs, [/^own(er)?_?name2$/i, /^owner2$/i])].map(str).filter(Boolean).join(" & ");
  const mailing = [get("mailing", [/^mail(ing)?_?addr(ess)?1?$/i, /mail.*addr/i]), pick(attrs, [/^mail(ing)?_?city$/i]), pick(attrs, [/^mail(ing)?_?st(ate)?$/i]), pick(attrs, [/^mail(ing)?_?zip/i])].map(str).filter(Boolean).join(", ");
  return {
    parcelId: str(get("parcelId", [/^pidn$/i, /^pin$/i, /^parcel_?(id|no|num(ber)?)$/i, /^map_?(id|no|num)$/i, /^apn$/i, /^gis_?pin$/i, /parcel/i, /^pid$/i])),
    ownerName: owner || null,
    ownerMailing: mailing || null,
    situsAddress: str(get("situs", [/^situs/i, /^(prop(erty)?_?)?addr(ess)?$/i, /^loc(ation)?(_?addr)?$/i, /^site_?addr/i, /address/i])),
    legalDescription: str(get("legal", [/^legal/i, /^desc(ription)?$/i, /legal_?desc/i])),
    acres: num(get("acres", [/^(gis_?|calc_?|deeded_?)?acres?$/i, /acre/i])),
    landUse: str(get("landUse", [/^(land_?)?use(_?desc)?$/i, /^prop(erty)?_?class/i, /^class(_?desc)?$/i, /zoning/i])),
    assessedValueCents: cents(get("assessed", [/^(total_?)?assess(ed)?(_?val(ue)?)?$/i, /^tot(al)?_?val(ue)?$/i, /^fair_?(cash|market)/i, /^fmv$/i, /assess/i, /value/i])),
    taxYear: num(get("taxYear", [/^tax_?y(ea)?r$/i, /^year$/i])),
    lastSaleDate: date(get("saleDate", [/^(last_?)?sale_?date$/i, /^deed_?date$/i, /sale.*date/i])),
    lastSalePriceCents: cents(get("salePrice", [/^(last_?)?sale_?(price|amt|amount)$/i, /^consid(eration)?$/i, /sale.*(price|amt)/i])),
    deedBook: str(get("deedBook", [/^deed_?b(oo)?k$/i, /^(db|book)$/i, /book/i])),
    deedPage: str(get("deedPage", [/^deed_?(pg|page)$/i, /^(dp|page|pg)$/i, /page/i])),
  };
}

// ─── Providers ────────────────────────────────────────────────────────────

const itemUrlCache = new Map<string, string>();
async function layerUrl(c: CountySource) {
  if (c.layerUrl) return c.layerUrl;
  if (!c.arcgisItemId) throw new Error(`${c.name}: no parcel layer configured`);
  const cached = itemUrlCache.get(c.arcgisItemId);
  if (cached) return cached;
  const res = await fetcher(`https://www.arcgis.com/sharing/rest/content/items/${c.arcgisItemId}?f=json`);
  if (!res.ok) throw new Error(`ArcGIS item lookup returned ${res.status}`);
  const item = (await res.json()) as { url?: string };
  if (!item.url) throw new Error(`${c.name}: the county's parcel layer isn't public`);
  const url = /\/(Feature|Map)Server\/?$/.test(item.url) ? `${item.url.replace(/\/$/, "")}/${c.layerIndex ?? 0}` : item.url;
  itemUrlCache.set(c.arcgisItemId, url);
  return url;
}

export async function countyLookup(c: CountySource, g: Geocode, q: ParcelQuery): Promise<ParcelResult> {
  const url = await layerUrl(c);
  const params = new URLSearchParams({ geometry: `${g.longitude},${g.latitude}`, geometryType: "esriGeometryPoint", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "*", returnGeometry: "true", outSR: "4326", f: "geojson" });
  const res = await fetcher(`${url}/query?${params}`);
  if (!res.ok) throw new Error(`${c.name} parcel service returned ${res.status}`);
  const body = (await res.json()) as { features?: { properties?: Record<string, unknown>; geometry?: GeoJsonGeometry }[]; error?: { message?: string } };
  if (body.error) throw new Error(`${c.name}: ${body.error.message ?? "parcel service error"}`);
  const f = body.features?.[0];
  const base = { latitude: g.latitude, longitude: g.longitude, countyFips: g.countyFips, countyName: c.name };
  if (!f?.properties) return empty(`county:${c.fips}`, { ...base, links: c.links(null), message: "No parcel found at this address on the county map." });
  const m = mapAttributes(f.properties, c.fields);
  return { ...empty(`county:${c.fips}`), ...base, ...m, status: "LOOKED_UP", situsAddress: m.situsAddress ?? q.addressLine1, geometry: f.geometry ?? null, links: c.links(m.parcelId), raw: f.properties };
}

export async function regridLookup(g: Geocode, token: string): Promise<ParcelResult> {
  const res = await fetcher(`https://app.regrid.com/api/v2/parcels/point?lat=${g.latitude}&lon=${g.longitude}&token=${encodeURIComponent(token)}&limit=1`);
  if (res.status === 401 || res.status === 403) throw new Error("Regrid rejected the API token");
  if (!res.ok) throw new Error(`Regrid returned ${res.status}`);
  const body = (await res.json()) as { parcels?: { features?: { properties?: { fields?: Record<string, unknown>; path?: string }; geometry?: GeoJsonGeometry }[] } };
  const f = body.parcels?.features?.[0];
  const base = { latitude: g.latitude, longitude: g.longitude, countyFips: g.countyFips, countyName: g.countyName };
  if (!f?.properties?.fields) return empty("regrid", { ...base, message: "Regrid found no parcel at this address." });
  const x = f.properties.fields;
  return {
    ...empty("regrid"), ...base, status: "LOOKED_UP",
    parcelId: str(x.parcelnumb), ownerName: str(x.owner), ownerMailing: [x.mailadd, x.mail_city, x.mail_state2, x.mail_zip].map(str).filter(Boolean).join(", ") || null,
    situsAddress: str(x.address), legalDescription: str(x.legaldesc), acres: num(x.ll_gisacre ?? x.gisacre ?? x.deeded_acres), landUse: str(x.usedesc ?? x.zoning_description ?? x.zoning),
    assessedValueCents: cents(x.parval), taxYear: num(x.taxyear), lastSaleDate: date(x.saledate), lastSalePriceCents: cents(x.saleprice),
    deedBook: str(x.deed_book ?? x.book), deedPage: str(x.deed_page ?? x.page), geometry: f.geometry ?? null,
    links: f.properties.path ? [{ label: "Regrid parcel page", url: `https://app.regrid.com${f.properties.path}` }] : [], raw: x,
  };
}

/** Rough centers for sample parcels, so demo maps land in the right town. */
const SAMPLE_CITIES: Record<string, { lat: number; lng: number; county: string; fips: string }> = {
  "CHICAGO|IL": { lat: 41.89, lng: -87.66, county: "Cook County, IL", fips: "17031" },
  "EVANSTON|IL": { lat: 42.045, lng: -87.69, county: "Cook County, IL", fips: "17031" },
  "SPRINGFIELD|IL": { lat: 39.78, lng: -89.65, county: "Sangamon County, IL", fips: "17167" },
  "MONTICELLO|KY": { lat: 36.83, lng: -84.85, county: "Wayne County, KY", fips: "21231" },
};

/** Deterministic sample parcel (a lot-shaped rectangle at a stable spot derived from the address). */
export function mockLookup(q: ParcelQuery, at?: { latitude: number; longitude: number }): ParcelResult {
  let h = 0;
  for (const ch of `${q.addressLine1}|${q.city}|${q.state}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const city = SAMPLE_CITIES[`${q.city.toUpperCase()}|${q.state.toUpperCase()}`] ?? SAMPLE_CITIES["MONTICELLO|KY"]!;
  const lat = at?.latitude ?? city.lat + ((h % 1000) / 1000 - 0.5) * 0.06;
  const lng = at?.longitude ?? city.lng + (((h >>> 10) % 1000) / 1000 - 0.5) * 0.06;
  const w = 0.00035 + ((h >>> 3) % 5) * 0.00004;
  const d = 0.00028;
  const ring = [[lng - w, lat - d], [lng + w, lat - d], [lng + w, lat + d], [lng - w, lat + d], [lng - w, lat - d]];
  const parcel = `${String(100 + (h % 900)).padStart(3, "0")}-${String((h >>> 8) % 100).padStart(2, "0")}-${String((h >>> 4) % 1000).padStart(3, "0")}.00`;
  return {
    ...empty("mock"), status: "LOOKED_UP", latitude: lat, longitude: lng, countyFips: city.fips, countyName: `${city.county} (sample)`,
    parcelId: parcel, ownerName: (q.ownerHint ?? "SAMPLE OWNER LLC").toUpperCase(), ownerMailing: `${q.addressLine1.toUpperCase()}, ${q.city.toUpperCase()}, ${q.state} ${q.postalCode}`,
    situsAddress: q.addressLine1.toUpperCase(), legalDescription: `LOT ${1 + (h % 40)} BLOCK ${1 + ((h >>> 6) % 12)} SAMPLE SUBDIVISION`, acres: Math.round((0.18 + ((h >>> 5) % 30) / 100) * 100) / 100,
    landUse: "RESIDENTIAL", assessedValueCents: (90_000 + (h % 250) * 1000) * 100, taxYear: new Date().getFullYear() - 1, lastSaleDate: `${2012 + (h % 12)}-0${1 + (h % 9)}-15`,
    lastSalePriceCents: (80_000 + (h % 200) * 1000) * 100, deedBook: String(200 + (h % 300)), deedPage: String(1 + (h % 700)),
    geometry: { type: "Polygon", coordinates: [ring] }, links: [{ label: "Sample record — real lookups use the county's public map", url: "https://opengisdata.ky.gov/" }], raw: { sample: true },
  };
}

export type ParcelProviderName = "auto" | "mock" | "off";
export const parcelProviderName = (): ParcelProviderName => (process.env.PARCELS_PROVIDER === "mock" || process.env.PARCELS_PROVIDER === "off" ? process.env.PARCELS_PROVIDER : "auto");

/** Run the lookup chain for one address. Throws on network/service errors (the caller records them). */
export async function lookupParcel(q: ParcelQuery): Promise<ParcelResult> {
  const mode = parcelProviderName();
  if (mode === "off") return empty("off", { message: "Land-record lookups are turned off (PARCELS_PROVIDER=off)." });
  if (mode === "mock") return mockLookup(q);
  let g = await geocode(q);
  if (!g) return empty("geocoder", { message: "The US Census geocoder couldn't match this address. Check the street address and ZIP." });
  if (g.countyFips?.startsWith("21")) g = await refineKentucky(q, g); // Kentucky

  const county = g.countyFips ? countyByFips(g.countyFips) : null;
  if (county) return countyLookup(county, g, q);
  const token = process.env.REGRID_TOKEN;
  if (token) return regridLookup(g, token);
  return empty("none", { latitude: g.latitude, longitude: g.longitude, countyFips: g.countyFips, countyName: g.countyName, message: `${g.countyName ?? "This county"} isn't connected yet. Add a Regrid token (REGRID_TOKEN) to look up parcels anywhere in the US.` });
}
