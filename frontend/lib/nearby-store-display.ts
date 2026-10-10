import type { NearbyPlace } from "./live-data";

/** Location discovery is independent of whether a retailer exposes prices. */
export function nearbyGroceryStores(places: NearbyPlace[], query = "") {
  const term = query.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  return places.filter((place) => {
    if (place.kind !== "grocery" || seen.has(place.id)) return false;
    seen.add(place.id);
    return !term || `${place.name} ${place.address}`.toLocaleLowerCase().includes(term);
  });
}
