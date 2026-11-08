/**
 * Counties whose public parcel maps DeedWood reads directly (free). Keyed by 5-digit county FIPS.
 *
 * To add a county: find its public parcel layer (most Kentucky counties publish one on ArcGIS
 * Online — search the KyGovMaps Open Data Portal or the county PVA site), then add an entry with
 * either the ArcGIS Online item id (`arcgisItemId`) or the layer's REST URL (`layerUrl`, ending in
 * /FeatureServer/0 or /MapServer/0). Field names are detected automatically; set `fields` only
 * when detection picks the wrong column. The `parcel_coverage` unit test checks every entry.
 */
export type CountySource = {
  fips: string;
  name: string;
  state: string;
  /** ArcGIS Online item id of the parcel layer (resolved to its service URL at lookup time). */
  arcgisItemId?: string;
  /** Or the layer URL directly. */
  layerUrl?: string;
  layerIndex?: number;
  /** Explicit attribute names, when automatic detection needs help. */
  fields?: Partial<Record<"parcelId" | "owner" | "owner2" | "mailing" | "situs" | "legal" | "acres" | "landUse" | "assessed" | "taxYear" | "saleDate" | "salePrice" | "deedBook" | "deedPage", string>>;
  /** Where to read more: PVA (assessor), county clerk (deeds), GIS map. */
  links: (parcelId: string | null) => { label: string; url: string }[];
};

/** Links shared by every Kentucky county. */
const kyLinks = (county: string, extra: { label: string; url: string }[] = []) => (parcelId: string | null) => [
  ...extra,
  { label: `${county} PVA property search (qPublic)${parcelId ? ` — search parcel ${parcelId}` : ""}`, url: "https://qpublic.schneidercorp.com/" },
  { label: "Kentucky GIS open data (KyGovMaps)", url: "https://opengisdata.ky.gov/" },
];

export const COUNTIES: CountySource[] = [
  {
    fips: "21231",
    name: "Wayne County, KY",
    state: "KY",
    // "Wayne County Land Parcels" (ArcGIS Online, 2024).
    arcgisItemId: "8709730aa2774a58aa41568f2febbb69",
    links: kyLinks("Wayne County", [
      { label: "Wayne County PVA (assessments, Monticello)", url: "https://waynecounty.ky.gov/eo/Pages/pva.aspx" },
      { label: "Wayne County parcel map (ArcGIS)", url: "https://www.arcgis.com/home/item.html?id=8709730aa2774a58aa41568f2febbb69" },
    ]),
  },
];

const byFips = new Map(COUNTIES.map((c) => [c.fips, c]));
export const countyByFips = (fips: string) => byFips.get(fips) ?? null;
