import { z } from "zod";
import type { NearbyPlace } from "./live-data";

export const ROUTE_PREVIEW_KEY = "stretch.route-preview.v2";
const LEGACY_KEY = "stretch.route-preview.v1";
export const MAX_PREVIEW_STORES = 3;

const stopSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), address: z.string(),
  lat: z.number().finite().min(-90).max(90), lon: z.number().finite().min(-180).max(180),
});
const planSchema = z.object({
  stops: z.array(stopSchema).max(MAX_PREVIEW_STORES),
  originLat: z.number().finite(), originLon: z.number().finite(),
});
const legacySchema = stopSchema.extend({
  originLat: z.number().finite(), originLon: z.number().finite(),
});

export type RoutePreviewStop = z.infer<typeof stopSchema>;

/** Add or remove a physical grocery location, preserving the user's stop order. */
export function toggleRoutePreviewStop(stops: RoutePreviewStop[], place: NearbyPlace,
  maximum = MAX_PREVIEW_STORES): RoutePreviewStop[] {
  if (place.kind !== "grocery") return stops;
  if (stops.some((stop) => stop.id === place.id)) return stops.filter((stop) => stop.id !== place.id);
  if (stops.length >= Math.min(MAX_PREVIEW_STORES, Math.max(1, maximum))) return stops;
  const parsed = stopSchema.safeParse(place);
  return parsed.success ? [...stops, parsed.data] : stops;
}

/** Map locations are route waypoints only; no grocery price or stock is attached. */
export function writeRoutePreviewStops(storage: Pick<Storage, "setItem" | "removeItem">,
  stops: RoutePreviewStop[], origin: { lat: number; lon: number }) {
  try {
    const unique = new Set(stops.map((stop) => stop.id));
    const result = planSchema.safeParse({ stops, originLat: origin.lat, originLon: origin.lon });
    if (!result.success || unique.size !== stops.length) return false;
    if (!stops.length) storage.removeItem(ROUTE_PREVIEW_KEY);
    else storage.setItem(ROUTE_PREVIEW_KEY, JSON.stringify(result.data));
    storage.removeItem(LEGACY_KEY);
    return true;
  } catch { return false; }
}

export function readRoutePreviewStops(storage: Pick<Storage, "getItem">,
  origin: { lat: number; lon: number }): RoutePreviewStop[] {
  try {
    const value = storage.getItem(ROUTE_PREVIEW_KEY);
    const parsed = value === null
      ? legacySchema.safeParse(JSON.parse(storage.getItem(LEGACY_KEY) || "null"))
      : planSchema.safeParse(JSON.parse(value));
    if (!parsed.success) return [];
    if (Math.abs(parsed.data.originLat - origin.lat) > 0.00001 ||
      Math.abs(parsed.data.originLon - origin.lon) > 0.00001) return [];
    const stops = "stops" in parsed.data ? parsed.data.stops : [parsed.data];
    return stops.map(({ id, name, address, lat, lon }) => ({ id, name, address, lat, lon }));
  } catch { return []; }
}
