import { describe, expect, it } from "vitest";
import { readRoutePreviewStops, writeRoutePreviewStops, toggleRoutePreviewStop,
  ROUTE_PREVIEW_KEY } from "../lib/route-preview";
import type { NearbyPlace } from "../lib/live-data";

const origin = { lat: 33.77, lon: -84.38 };
const grocery: NearbyPlace = {
  id: "store-1", name: "Corner Grocer", kind: "grocery", address: "123 Main St",
  lat: 33.78, lon: -84.37, miles: 1, mapUrl: "https://maps.google.com/",
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

describe("mapped grocery route preview", () => {
  it("keeps up to three grocery stops in order without attaching product prices", () => {
    const storage = memoryStorage();
    const second = { ...grocery, id: "store-2", name: "Second Grocer" };
    const third = { ...grocery, id: "store-3", name: "Third Grocer" };
    const fourth = { ...grocery, id: "store-4", name: "Fourth Grocer" };
    let stops = toggleRoutePreviewStop([], grocery);
    stops = toggleRoutePreviewStop(stops, second);
    stops = toggleRoutePreviewStop(stops, third);
    expect(toggleRoutePreviewStop(stops, fourth)).toBe(stops);
    expect(writeRoutePreviewStops(storage, stops, origin)).toBe(true);
    expect(readRoutePreviewStops(storage, origin).map((stop) => stop.id)).toEqual([
      "store-1", "store-2", "store-3",
    ]);
    expect(storage.getItem(ROUTE_PREVIEW_KEY)).not.toContain("price");
    expect(toggleRoutePreviewStop(stops, second).map((stop) => stop.id)).toEqual(["store-1", "store-3"]);
  });
  it("rejects fuel stops, duplicate entries, and a changed starting area", () => {
    const storage = memoryStorage();
    expect(toggleRoutePreviewStop([], { ...grocery, kind: "fuel" })).toEqual([]);
    const stops = toggleRoutePreviewStop([], grocery);
    expect(writeRoutePreviewStops(storage, [...stops, ...stops], origin)).toBe(false);
    expect(writeRoutePreviewStops(storage, stops, origin)).toBe(true);
    expect(readRoutePreviewStops(storage, { ...origin, lat: 33.8 })).toEqual([]);
  });
  it("clears removed stops, ignores malformed data, and reads a previous one-store selection", () => {
    const storage = memoryStorage();
    const stops = toggleRoutePreviewStop([], grocery);
    writeRoutePreviewStops(storage, stops, origin);
    expect(writeRoutePreviewStops(storage, [], origin)).toBe(true);
    expect(readRoutePreviewStops(storage, origin)).toEqual([]);
    storage.setItem(ROUTE_PREVIEW_KEY, "{broken");
    expect(readRoutePreviewStops(storage, origin)).toEqual([]);
    storage.removeItem(ROUTE_PREVIEW_KEY);
    storage.setItem("stretch.route-preview.v1", JSON.stringify({
      ...stops[0], originLat: origin.lat, originLon: origin.lon,
    }));
    expect(readRoutePreviewStops(storage, origin)).toEqual(stops);
  });
});
