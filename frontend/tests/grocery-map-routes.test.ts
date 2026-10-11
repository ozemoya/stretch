import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchMapRoadRoute, groceryRoutePlaces, loadGroceryMapRoutes, roadRouteKey,
  storeDirectionsUrl, type GroceryMapRoute, type MapRoadRoute } from "../lib/grocery-map-routes";
import type { NearbyPlace } from "../lib/live-data";

const origin = { lat: 33.75, lon: -84.39 };
const store = (n: number): NearbyPlace => ({ id: `store-${n}`, name: `Store ${n}`, address: `${n} Main St`,
  kind: "grocery", lat: 33.76 + n / 1000, lon: -84.38, miles: 1, mapUrl: "https://maps.google.com/" });
const route: MapRoadRoute = { miles: 2, minutes: 6, geometry: { coordinates: [[-84.39, 33.75], [-84.38, 33.76]] } };
afterEach(() => vi.unstubAllGlobals());

describe("routes for every mapped grocery", () => {
  it("loads every grocery beyond the three-stop and twenty-result limits with bounded concurrency", async () => {
    const places = Array.from({ length: 120 }, (_, index) => store(index));
    const entries: GroceryMapRoute[] = [];
    let active = 0, peak = 0;
    const fetchRoute = vi.fn(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--; return route;
    });
    await loadGroceryMapRoutes(origin, [...places, places[0], { ...store(99), kind: "fuel" }], {
      signal: new AbortController().signal, cache: new Map(), onResult: (entry) => entries.push(entry), fetchRoute,
    });
    expect(fetchRoute).toHaveBeenCalledTimes(120);
    expect(peak).toBe(3);
    expect(entries).toHaveLength(120);
    expect(entries.every((entry) => entry.status === "completed")).toBe(true);
    expect(fetchRoute.mock.calls[0]).toEqual([[origin, places[0]], expect.any(AbortSignal)]);
  });

  it("reports a failed store route and still finishes the other stores", async () => {
    const entries: GroceryMapRoute[] = [];
    const fetchRoute = vi.fn().mockRejectedValueOnce(new Error("No road route")).mockResolvedValue(route);
    await loadGroceryMapRoutes(origin, [store(1), store(2)], { signal: new AbortController().signal,
      cache: new Map(), fetchRoute, onResult: (entry) => entries.push(entry) });
    expect(entries.find((entry) => entry.place.id === "store-1")).toEqual({ place: store(1), status: "error" });
    expect(entries.find((entry) => entry.place.id === "store-2")?.status).toBe("completed");
  });

  it("cancels queued work and ignores stale results even if a source completes after cancellation", async () => {
    const controller = new AbortController();
    const onResult = vi.fn();
    let finish!: (value: MapRoadRoute) => void;
    const fetchRoute = vi.fn(() => new Promise<MapRoadRoute>((resolve) => { finish = resolve; }));
    const cache = new Map<string, MapRoadRoute>();
    const task = loadGroceryMapRoutes(origin, [store(1), store(2)], {
      signal: controller.signal, cache, onResult, fetchRoute, concurrency: 1,
    });
    controller.abort(); finish(route); await task;
    expect(fetchRoute).toHaveBeenCalledTimes(1);
    expect(onResult).not.toHaveBeenCalled();
    expect(cache.size).toBe(0);
  });

  it("reuses page-loaded geometry but recalculates when the starting point changes", async () => {
    const cache = new Map<string, MapRoadRoute>();
    const fetchRoute = vi.fn().mockResolvedValue(route);
    const options = { cache, fetchRoute, onResult: vi.fn(), signal: new AbortController().signal };
    await loadGroceryMapRoutes(origin, [store(1)], options);
    await loadGroceryMapRoutes(origin, [store(1), store(2)], options);
    expect(fetchRoute).toHaveBeenCalledTimes(2);
    await loadGroceryMapRoutes({ ...origin, lat: 34 }, [store(1)], options);
    expect(fetchRoute).toHaveBeenCalledTimes(3);
    expect(roadRouteKey([origin, store(1)])).not.toBe(roadRouteKey([{ ...origin, lat: 34 }, store(1)]));
  });

  it("excludes gas stations and invalid coordinates without duplicating grocery locations", () => {
    expect(groceryRoutePlaces([store(1), store(1), { ...store(2), lat: NaN }, { ...store(3), kind: "fuel" }])).toEqual([store(1)]);
  });

  it("uses actual route geometry and rejects missing or invalid road data", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(route))
      .mockResolvedValueOnce(Response.json({ miles: 2, minutes: 6 }))
      .mockResolvedValueOnce(new Response("Unavailable", { status: 502 })));
    expect(await fetchMapRoadRoute([origin, store(1)], new AbortController().signal)).toEqual(route);
    await expect(fetchMapRoadRoute([origin, store(1)], new AbortController().signal)).rejects.toThrow("Invalid road route");
    await expect(fetchMapRoadRoute([origin, store(1)], new AbortController().signal)).rejects.toThrow("Road route unavailable");
  });

  it("links to the exact branch and starting point", () => {
    const link = new URL(storeDirectionsUrl(origin, store(1)));
    expect(link.searchParams.get("origin")).toBe("33.75,-84.39");
    expect(link.searchParams.get("destination")).toBe(`${store(1).lat},${store(1).lon}`);
    expect(link.searchParams.get("travelmode")).toBe("driving");
  });
});
