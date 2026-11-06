/**
 * AddressProvider adapter. The mock completes a typed street ("418 Oak") against a list of
 * cities so the wizard's autocomplete works offline. Swap in a real geocoder (Google Places,
 * Mapbox, Smarty) by implementing `suggest`.
 */
export type AddressSuggestion = { addressLine1: string; city: string; state: string; postalCode: string; label: string };

export interface AddressProvider {
  readonly name: string;
  suggest(query: string): Promise<AddressSuggestion[]>;
}

const CITIES = [
  { city: "Springfield", state: "IL", postalCode: "62701" },
  { city: "Madison", state: "WI", postalCode: "53703" },
  { city: "Columbus", state: "OH", postalCode: "43215" },
  { city: "Austin", state: "TX", postalCode: "78701" },
  { city: "Raleigh", state: "NC", postalCode: "27601" },
  { city: "Denver", state: "CO", postalCode: "80202" },
  { city: "Portland", state: "OR", postalCode: "97205" },
  { city: "Chicago", state: "IL", postalCode: "60614" },
  { city: "Evanston", state: "IL", postalCode: "60201" },
  { city: "Oak Park", state: "IL", postalCode: "60302" },
];
const SUFFIXES = ["St", "Ave", "Blvd", "Rd", "Ln", "Dr", "Ct", "Way", "Pl"];

export class MockAddressProvider implements AddressProvider {
  readonly name = "mock";
  async suggest(query: string): Promise<AddressSuggestion[]> {
    const q = query.trim().replace(/\s+/g, " ");
    const m = /^(\d{1,6})\s+([A-Za-z][A-Za-z .'-]{1,60})$/.exec(q);
    if (!m) return [];
    let street = m[2]!.replace(/\b\w/g, (c) => c.toUpperCase());
    if (!SUFFIXES.some((s) => new RegExp(`\\b${s}\\.?$`, "i").test(street))) street = `${street} St`;
    const line1 = `${m[1]} ${street}`;
    return CITIES.slice(0, 5).map((c) => ({ addressLine1: line1, ...c, label: `${line1}, ${c.city}, ${c.state} ${c.postalCode}` }));
  }
}

let provider: AddressProvider | undefined;
export function getAddressProvider(): AddressProvider {
  provider ??= new MockAddressProvider();
  return provider;
}
