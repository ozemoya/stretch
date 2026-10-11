import type { NearbyPlace } from "./live-data";

// Multiple Places entries can describe one forecourt and its convenience shop.
// Keep distinct locations, even if they share a chain name.
export function deduplicatePhysicalStations(places: NearbyPlace[], hasPrice: (place: NearbyPlace) => boolean) {
  const result: NearbyPlace[] = [];
  for (const place of places) {
    const address = place.address.trim().toLowerCase();
    const duplicate = /^\d+\b/.test(address) ? result.findIndex((prior) =>
      prior.address.trim().toLowerCase() === address &&
      Math.abs(prior.lat - place.lat) < 0.0003 && Math.abs(prior.lon - place.lon) < 0.0003) : -1;
    if (duplicate < 0) result.push(place);
    else if (hasPrice(place) && !hasPrice(result[duplicate])) result[duplicate] = place;
  }
  return result;
}
