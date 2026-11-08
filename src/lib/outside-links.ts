/**
 * "See it on…" links for a property. These open the other site's own page (free to view there);
 * DeedWood doesn't copy data from them — their terms don't allow it.
 */
export function outsideLinks(address: { addressLine1: string; city: string; state: string; postalCode: string }, at?: { latitude: number | null; longitude: number | null }) {
  const one = `${address.addressLine1}, ${address.city}, ${address.state} ${address.postalCode}`;
  const q = encodeURIComponent(one);
  const hasPoint = at?.latitude != null && at?.longitude != null;
  const slug = one.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return [
    { label: "Google Earth", url: `https://earth.google.com/web/search/${q}` },
    { label: "Google Maps (satellite)", url: hasPoint ? `https://www.google.com/maps/@?api=1&map_action=map&center=${at!.latitude},${at!.longitude}&zoom=19&basemap=satellite` : `https://www.google.com/maps/search/?api=1&query=${q}` },
    { label: "Zillow", url: `https://www.zillow.com/homes/${slug}_rb/` },
  ];
}
