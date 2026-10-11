import type { NearbyPlace } from "./live-data";
import { retailerName } from "./retailer-coverage";

const normalize = (name: string) => name.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]/g, "");
/** A catalog-to-map match is a destination suggestion, never a branch price verification. */
export function productRouteStop(retailer: string, places: NearbyPlace[]) {
  const canonical = retailerName({ name: retailer });
  return places.filter((place) => place.kind === "grocery" && Number.isFinite(place.lat) && Number.isFinite(place.lon) &&
    (canonical !== "Independent / other retailer"
      ? retailerName(place) === canonical
      : normalize(place.name) === normalize(retailer)))
    .sort((a, b) => a.miles - b.miles || a.id.localeCompare(b.id))[0] ?? null;
}
