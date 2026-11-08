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

export const COUNTIES: CountySource[] = [
  {
    // Louisville / Jefferson County — LOJIC (Louisville/Jefferson County Information Consortium), official.
    // Outlines and parcel IDs only; owner names and values are on the Jefferson County PVA site.
    fips: "21111",
    name: "Jefferson County, KY",
    state: "KY",
    layerUrl: "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1",
    fields: { parcelId: "PARCELID" },
    links: (parcelId) => [
      { label: `Jefferson County PVA property search${parcelId ? ` — parcel ${parcelId}` : ""}`, url: "https://jeffersonpva.ky.gov/property-search/" },
      { label: "LOJIC open data (official parcel map)", url: "https://data.lojic.org/" },
    ],
  },
];

const byFips = new Map(COUNTIES.map((c) => [c.fips, c]));
export const countyByFips = (fips: string) => byFips.get(fips) ?? null;
