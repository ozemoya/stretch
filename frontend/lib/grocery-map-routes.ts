import type { NearbyPlace } from "./live-data";

export type MapPoint = { lat: number; lon: number };
export type MapRoadRoute = {
  steps?: { instruction: string; distanceMeters: number; legIndex: number; lat?: number; lon?: number }[];
  miles: number;
  minutes: number;
  geometry: { coordinates: [number, number][] };
};
export type GroceryMapRoute = {
  place: NearbyPlace;
  status: "completed" | "error";
  route?: MapRoadRoute;
};

export function roadRouteKey(points: MapPoint[]) {
  return "directions-v1:" + points.map(({ lat, lon }) => `${lat},${lon}`).join("|");
}

export function groceryRoutePlaces(places: NearbyPlace[]) {
  return [...new Map(places.filter((place) => place.kind === "grocery" &&
    Number.isFinite(place.lat) && Math.abs(place.lat) <= 90 &&
    Number.isFinite(place.lon) && Math.abs(place.lon) <= 180)
    .map((place) => [place.id, place])).values()];
}

export function storeDirectionsUrl(origin: MapPoint, store: MapPoint) {
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1",
    origin: `${origin.lat},${origin.lon}`, destination: `${store.lat},${store.lon}`, travelmode: "driving" })}`;
}

export async function fetchMapRoadRoute(points: MapPoint[], signal: AbortSignal): Promise<MapRoadRoute> {
  const response = await fetch("/api/routes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ points: points.map(({ lat, lon }) => ({ lat, lon })) }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(50000)]),
  });
  if (!response.ok) throw new Error("Road route unavailable");
  const route = await response.json();
  if (!Number.isFinite(route?.miles) || route.miles < 0 ||
      !Number.isFinite(route?.minutes) || route.minutes < 0 ||
      !Array.isArray(route.geometry?.coordinates) || route.geometry.coordinates.length < 2 ||
      !route.geometry.coordinates.every((point: unknown) => Array.isArray(point) && point.length === 2 &&
        Number.isFinite(point[0]) && Math.abs(point[0]) <= 180 &&
        Number.isFinite(point[1]) && Math.abs(point[1]) <= 90))
    throw new Error("Invalid road route");
  return route;
}

/** Route to every discovered grocery, independently of the chosen trip's stop limit.
 * The caller owns a page-lifetime cache; route geometry is never persisted to storage.
 */
export async function loadGroceryMapRoutes(origin: MapPoint, places: NearbyPlace[], options: {
  signal: AbortSignal;
  onResult: (entry: GroceryMapRoute) => void;
  cache: Map<string, MapRoadRoute>;
  fetchRoute?: typeof fetchMapRoadRoute;
  concurrency?: number;
}) {
  const queue = groceryRoutePlaces(places);
  const fetchRoute = options.fetchRoute ?? fetchMapRoadRoute;
  let cursor = 0;
  async function worker() {
    while (!options.signal.aborted && cursor < queue.length) {
      const place = queue[cursor++];
      const points = [origin, place];
      const key = roadRouteKey(points);
      try {
        const route = options.cache.get(key) ?? await fetchRoute(points, options.signal);
        if (options.signal.aborted) return;
        options.cache.set(key, route);
        options.onResult({ place, route, status: "completed" });
      } catch {
        if (options.signal.aborted) return;
        options.onResult({ place, status: "error" });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(queue.length, Math.max(1, Math.min(4, options.concurrency ?? 3))) }, worker));
}
