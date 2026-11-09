"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, ExternalLink, Map as MapIcon, Satellite, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addAerialPhotoAction, setStreetViewCoverAction } from "@/server/actions/images";

type Link = { label: string; url: string };

/**
 * "Get a picture of this place": upload your own, a free aerial photo, Google Street View
 * (when a Google Maps key is set up), or find one on Zillow / Google Maps and upload it.
 */
export function PlacePicture({ propertyId, hasPhotos, streetView, streetViewCover, links }: { propertyId: string; hasPhotos: boolean; streetView: boolean; streetViewCover: boolean; links: Link[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<"aerial" | "street" | null>(null);
  const [svOk, setSvOk] = React.useState(true);
  return (
    <section aria-labelledby="pp-h" className="rounded-card border border-border bg-surface p-4 shadow-card">
      <h2 id="pp-h" className="text-lg font-semibold">Get a picture of this place</h2>
      <p className="mb-3 text-sm text-muted-foreground">The main picture shows on your property list, on this page and in the owner&apos;s portal. Pick any of these:</p>
      <ol className="grid gap-3 md:grid-cols-2">
        <li className="rounded-lg border border-border p-3">
          <p className="flex items-center gap-2 font-semibold"><Camera className="size-4" aria-hidden /> 1. Use your own photo</p>
          <p className="mt-1 text-sm text-muted-foreground">Drag a photo into the box below, or click “browse”. On a phone you can take a picture with the camera.</p>
        </li>
        <li className="rounded-lg border border-border p-3">
          <p className="flex items-center gap-2 font-semibold"><Satellite className="size-4" aria-hidden /> 2. Aerial photo (free)</p>
          <p className="mt-1 text-sm text-muted-foreground">A picture from above, taken by the U.S. government. Works for any U.S. address.</p>
          <Button className="mt-2" size="sm" loading={busy === "aerial"} onClick={async () => {
            setBusy("aerial");
            const r = await addAerialPhotoAction(propertyId, !hasPhotos && !streetViewCover);
            setBusy(null);
            if (!r.ok) return void toast.error(r.error);
            toast.success("Aerial photo added");
            router.refresh();
          }}>Get aerial photo</Button>
        </li>
        <li className="rounded-lg border border-border p-3">
          <p className="flex items-center gap-2 font-semibold"><MapIcon className="size-4" aria-hidden /> 3. Street View (Google)</p>
          {streetView ? (
            svOk ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/street-view/${propertyId}?size=small`} alt="Google Street View of the address" className="mt-2 aspect-[4/3] w-full max-w-xs rounded-lg border border-border object-cover" onError={() => setSvOk(false)} />
                <Button className="mt-2" size="sm" variant={streetViewCover ? "secondary" : "primary"} loading={busy === "street"} onClick={async () => {
                  setBusy("street");
                  const r = await setStreetViewCoverAction(propertyId, !streetViewCover);
                  setBusy(null);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(streetViewCover ? "Street View picture removed" : "Street View is now the main picture");
                  router.refresh();
                }}>{streetViewCover ? "Stop using it" : <><Star aria-hidden /> Use as main picture</>}</Button>
                {streetViewCover ? <p className="mt-1 text-xs font-medium text-success">This is the main picture now.</p> : null}
              </>
            ) : <p className="mt-1 text-sm text-muted-foreground">Google doesn&apos;t have a street picture of this address.</p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">The front of the building, from the street. To turn this on, add a Google Maps key (see “Pictures from Google” in the README). Until then, use the links in 4.</p>
          )}
        </li>
        <li className="rounded-lg border border-border p-3">
          <p className="flex items-center gap-2 font-semibold"><ExternalLink className="size-4" aria-hidden /> 4. Zillow, Google Maps or Google Earth</p>
          <p className="mt-1 text-sm text-muted-foreground">These sites don&apos;t let other apps copy their pictures automatically. Open one, save the picture to your computer or phone, then upload it in the box below.</p>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {links.map((l) => <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{l.label}<span className="sr-only"> (opens in a new tab)</span></a>)}
          </p>
        </li>
      </ol>
    </section>
  );
}
