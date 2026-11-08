/** Dev helper: real land-record lookup for an address. Usage: tsx scripts/dev/parcel-lookup.ts "527 W Jefferson St" Louisville KY 40202 */
import { lookupParcel } from "../../src/adapters/parcels";
const [addressLine1, city, state, postalCode] = process.argv.slice(2);
process.env.PARCELS_PROVIDER = "auto";
lookupParcel({ addressLine1: addressLine1!, city: city!, state: state!, postalCode: postalCode! })
  .then((r) => console.log(JSON.stringify({ ...r, geometry: r.geometry ? `${r.geometry.type} (${JSON.stringify(r.geometry.coordinates).length} chars)` : null, raw: r.raw ? Object.keys(r.raw) : null }, null, 1)))
  .catch((e) => console.error("ERROR", e.message));
