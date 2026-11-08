import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwnerPortal } from "@/server/portal/owner-context";
import { landRecordView } from "@/server/rentals/land-records";
import { getSettings } from "@/server/settings/service";
import { LandRecord } from "@/components/rentals/land-record";

export const metadata = { title: "Land records" };

/** Owner portal: the parcel map, owner of record and land documents for one property they own. */
export default async function OwnerPropertyRecords({ params }: { params: Promise<{ propertyId: string }> }) {
  const { propertyId } = await params;
  const o = await requireOwnerPortal();
  const p = o.properties.find((x) => x.id === propertyId);
  if (!p) notFound();
  const s = await getSettings(o.db, ["ownerPortal.showLandRecords"], { orgId: o.org.id, propertyId });
  if (!s["ownerPortal.showLandRecords"].value) notFound();
  const property = await o.db.property.findFirstOrThrow({ where: { id: propertyId } });
  const view = await landRecordView(o.db, propertyId, (id) => `/api/owner/files/${id}`);
  return (
    <div className="grid gap-4">
      <p className="text-sm"><Link href="/portal/owner/properties" className="text-primary hover:underline">← Your properties</Link></p>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{property.name}</h1>
        <p className="text-sm text-muted-foreground">{property.addressLine1}, {property.city}, {property.state} {property.postalCode} · you own {p.percentBps / 100}%</p>
      </div>
      <LandRecord mode="owner" propertyId={propertyId} propertyName={property.name} address={property} {...view} />
    </div>
  );
}
