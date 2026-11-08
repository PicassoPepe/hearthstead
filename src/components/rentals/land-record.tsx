import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Landmark } from "lucide-react";
import { ParcelMap } from "./parcel-map";
import { LandDocsUpload, RefreshLandRecordButton } from "./land-record-actions";
import { formatMoney } from "@/lib/money";

export type LandRecordData = {
  status: string;
  source: string;
  error: string | null;
  fetchedAt: string;
  latitude: number | null;
  longitude: number | null;
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
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown } | null;
  links: { label: string; url: string }[];
};
export type LandDoc = { id: string; name: string; category: string; href: string };

const DOC_LABEL: Record<string, string> = { Deed: "Deed", TitlePolicy: "Title policy", Survey: "Survey", Plat: "Plat" };
const sourceLabel = (s: string, county: string | null) => (s.startsWith("county:") ? `${county ?? "County"} public parcel map` : s === "regrid" ? "Regrid parcel data" : s === "mock" ? "Sample data (demo)" : s);

/**
 * Land records for one property: map with the parcel outline, owner of record (with a mismatch
 * warning against the owners on file), parcel facts, county links, and deed/title/survey documents.
 * `mode="owner"` is the read-only owner-portal view.
 */
export function LandRecord({ propertyId, propertyName, record, ownersOnFile, match, docs, mode }: {
  propertyId: string; propertyName: string; record: LandRecordData | null; ownersOnFile: string[]; match: boolean | null; docs: LandDoc[]; mode: "staff" | "owner";
}) {
  const staff = mode === "staff";
  const facts: [string, React.ReactNode][] = record ? [
    ["Parcel ID", record.parcelId],
    ["Owner of record", record.ownerName],
    ["Owner mailing address", record.ownerMailing],
    ["Site address", record.situsAddress],
    ["Acres", record.acres !== null ? record.acres.toLocaleString("en-US", { maximumFractionDigits: 3 }) : null],
    ["Land use", record.landUse],
    [`Assessed value${record.taxYear ? ` (${record.taxYear})` : ""}`, record.assessedValueCents !== null ? formatMoney(record.assessedValueCents, { showCents: false }) : null],
    ["Last sale", record.lastSaleDate ? `${record.lastSaleDate}${record.lastSalePriceCents ? ` · ${formatMoney(record.lastSalePriceCents, { showCents: false })}` : ""}` : null],
    ["Deed book / page", record.deedBook || record.deedPage ? `Book ${record.deedBook ?? "—"}, page ${record.deedPage ?? "—"}` : null],
    ["Legal description", record.legalDescription],
  ] : [];
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-testid="land-record">
      <div className="grid content-start gap-3">
        <ParcelMap geometry={record?.geometry ?? null} latitude={record?.latitude ?? null} longitude={record?.longitude ?? null} label={propertyName} />
        {record?.links.length ? (
          <ul className="grid gap-1 text-sm">
            {record.links.map((l) => (
              <li key={l.url + l.label}><a href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-primary hover:underline"><ExternalLink className="size-3.5" aria-hidden />{l.label}</a></li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="grid content-start gap-4">
        <section aria-labelledby={`lr-${propertyId}`} className="rounded-card border border-border bg-surface p-4 shadow-card">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id={`lr-${propertyId}`} className="flex items-center gap-2 font-semibold"><Landmark className="size-4" aria-hidden /> County land record</h2>
            {staff ? <RefreshLandRecordButton propertyId={propertyId} hasRecord={Boolean(record)} /> : null}
          </div>
          {!record ? (
            <p className="text-sm text-muted-foreground">{staff ? "Not looked up yet. DeedWood finds the parcel from the address using the county's public records." : "Your property manager hasn't added the county record yet."}</p>
          ) : (
            <>
              {record.status !== "LOOKED_UP" ? <p role="status" className="mb-3 rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground">{record.error ?? "No parcel found for this address."}</p> : null}
              {record.status === "LOOKED_UP" && match !== null ? (
                match ? (
                  <p className="mb-3 flex items-start gap-2 rounded-lg bg-success-soft p-3 text-sm text-success-soft-foreground"><CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden /><span>Owner of record matches the owner{ownersOnFile.length > 1 ? "s" : ""} on file.</span></p>
                ) : (
                  <p role="alert" className="mb-3 flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning-soft-foreground"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /><span>The county lists <strong>{record.ownerName}</strong> as the owner, but {staff ? "your records say" : "we have"} {ownersOnFile.join(", ")}. {staff ? "Check the deed — the sale may be recent or recorded under an LLC or trust." : "Your manager will confirm."}</span></p>
                )
              ) : null}
              <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                {facts.filter(([, v]) => v !== null && v !== "").map(([k, v]) => (
                  <div key={k} className={k === "Legal description" || k === "Owner mailing address" ? "sm:col-span-2" : undefined}><dt className="text-xs text-muted-foreground">{k}</dt><dd className="mt-0.5 break-words">{v}</dd></div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">Source: {sourceLabel(record.source, record.countyName)} · updated {new Date(record.fetchedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}. Public records can lag recent sales. Not a title search or survey.</p>
            </>
          )}
        </section>
        <section aria-labelledby={`ld-${propertyId}`} className="rounded-card border border-border bg-surface p-4 shadow-card">
          <h2 id={`ld-${propertyId}`} className="mb-2 flex items-center gap-2 font-semibold"><FileText className="size-4" aria-hidden /> Deed, title &amp; survey</h2>
          {docs.length ? (
            <ul className="mb-3 divide-y divide-border text-sm" data-testid="land-docs">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2"><a href={d.href} target="_blank" rel="noreferrer" className="truncate font-medium text-primary hover:underline">{d.name}</a><span className="shrink-0 text-xs text-muted-foreground">{DOC_LABEL[d.category] ?? d.category}</span></li>
              ))}
            </ul>
          ) : <p className="mb-3 text-sm text-muted-foreground">No deed, title policy or survey attached yet.</p>}
          {staff ? <LandDocsUpload propertyId={propertyId} /> : null}
          {staff ? <p className="mt-2 text-xs text-muted-foreground">Title reports (liens, easements, chain of title) come from a title company — attach them here. Owners see these documents in their portal.</p> : null}
        </section>
      </div>
    </div>
  );
}
