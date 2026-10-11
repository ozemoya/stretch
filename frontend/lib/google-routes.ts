type Point = { lat: number; lon: number };
type Leg = { miles: number; minutes: number };
const METRES_PER_MILE = 1609.344;

function waypoint(point: Point) {
  return { location: { latLng: { latitude: point.lat, longitude: point.lon } } };
}

export function decodeGooglePolyline(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0, lat = 0, lon = 0;
  while (index < encoded.length) {
    const changes: number[] = [];
    for (let coordinate = 0; coordinate < 2; coordinate++) {
      let value = 0, shift = 0, byte: number;
      do {
        if (index >= encoded.length) throw new Error("Invalid route geometry");
        byte = encoded.charCodeAt(index++) - 63;
        value |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20 && shift < 35);
      changes.push(value & 1 ? ~(value >> 1) : value >> 1);
    }
    lat += changes[0]; lon += changes[1];
    coordinates.push([lon / 1e5, lat / 1e5]);
  }
  return coordinates;
}

function seconds(value: unknown) {
  return typeof value === "string" && /^\d+(?:\.\d+)?s$/.test(value) ? Number(value.slice(0, -1)) : NaN;
}

async function googlePost(path: string, body: unknown, mask: string, key: string, signal: AbortSignal) {
  const response = await fetch(`https://routes.googleapis.com/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": mask }, body: JSON.stringify(body), signal, cache: "no-store",
  });
  if (!response.ok) throw new Error(`Google Routes returned ${response.status}`);
  return response.json();
}

export async function googleRouteMatrix(points: Point[], key: string, signal: AbortSignal) {
  const data = await googlePost("distanceMatrix/v2:computeRouteMatrix", {
    origins: points.map((point) => ({ waypoint: waypoint(point) })),
    destinations: points.map((point) => ({ waypoint: waypoint(point) })),
    travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE",
  }, "originIndex,destinationIndex,status,condition,distanceMeters,duration", key, signal);
  if (!Array.isArray(data)) throw new Error("Invalid Google route matrix");
  const distances: (number | null)[][] = points.map(() => points.map(() => null));
  const durations: (number | null)[][] = points.map(() => points.map(() => null));
  for (const element of data) {
    const from = element.originIndex, to = element.destinationIndex;
    const duration = seconds(element.duration);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < 0 ||
      from >= points.length || to >= points.length || element.condition !== "ROUTE_EXISTS" ||
      !Number.isFinite(element.distanceMeters) || element.distanceMeters < 0 ||
      !Number.isFinite(duration) || duration < 0) continue;
    distances[from][to] = element.distanceMeters;
    durations[from][to] = duration;
  }
  return { distances, durations, provider: "google" as const };
}

export async function googleRoute(points: Point[], key: string, signal: AbortSignal) {
  const data = await googlePost("directions/v2:computeRoutes", {
    origin: waypoint(points[0]), destination: waypoint(points.at(-1)!),
    intermediates: points.slice(1, -1).map(waypoint),
    travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE",
  }, "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration",
  key, signal);
  const route = data.routes?.[0];
  const coordinates = typeof route?.polyline?.encodedPolyline === "string"
    ? decodeGooglePolyline(route.polyline.encodedPolyline) : [];
  const duration = seconds(route?.duration);
  if (!Number.isFinite(route?.distanceMeters) || !Number.isFinite(duration) || coordinates.length < 2 ||
    !Array.isArray(route?.legs) || route.legs.length !== points.length - 1) throw new Error("No Google driving route found");
  const legs: Leg[] = route.legs.map((leg: { distanceMeters: number; duration: string }) => ({
    miles: leg.distanceMeters / METRES_PER_MILE, minutes: seconds(leg.duration) / 60,
  }));
  if (legs.some((leg) => !Number.isFinite(leg.miles) || !Number.isFinite(leg.minutes)))
    throw new Error("Invalid Google route legs");
  return { miles: route.distanceMeters / METRES_PER_MILE, minutes: duration / 60,
    legs, geometry: { type: "LineString" as const, coordinates }, provider: "google" as const };
}
