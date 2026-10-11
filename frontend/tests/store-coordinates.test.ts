import { afterEach, expect, it, vi } from "vitest";
import { resolveStoreCoordinates, storeAddress, validStoreCoordinates } from "../lib/store-coordinates.mjs";
import { resolveMappedLocations, normalizePlaces } from "../lib/live-data";
const address = "1225 Caroline St NE, Atlanta, GA 30307";
const match = { coordinates: { x: -84.348, y: 33.756 }, addressComponents: { zip: "30307" } };
const response = (matches = [match]) => Response.json({ result: { addressMatches: matches } });
afterEach(() => vi.unstubAllGlobals());

it("retains complete explicit coordinates without a geocoding request", async () => {
  const fetcher = vi.fn();
  expect(await resolveStoreCoordinates({ latitude: "33.756", longitude: -84.348, address }, { fetcher }))
    .toEqual({ latitude: 33.756, longitude: -84.348, source: "explicit" });
  expect(validStoreCoordinates(0, 0)).toBe(true);
  expect(validStoreCoordinates(null, null)).toBe(false);
  expect(validStoreCoordinates(true, -84)).toBe(false);
  expect(validStoreCoordinates(91, -84)).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
});

it("geocodes missing or invalid pairs using the complete street address and correct axes", async () => {
  const fetcher = vi.fn().mockImplementation(() => response());
  expect(await resolveStoreCoordinates({ latitude: 999, longitude: null, address }, { fetcher }))
    .toEqual({ latitude: 33.756, longitude: -84.348, source: "census-address" });
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.hostname).toBe("geocoding.geo.census.gov");
  expect(url.searchParams.get("address")).toBe(address);
  expect(url.searchParams.get("benchmark")).toBe("Public_AR_Current");
  expect(storeAddress({ addressLine1: "1225 Caroline St NE", city: "Atlanta", state: "GA", zipCode: "30307" })).toBe(address);
});

it("shares concurrent address lookups and caches successful matches", async () => {
  const fetcher = vi.fn().mockImplementation(() => response());
  await Promise.all([resolveStoreCoordinates({ address }, { fetcher }),
    resolveStoreCoordinates({ address: address.toUpperCase() }, { fetcher })]);
  await resolveStoreCoordinates({ address }, { fetcher });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects missing street addresses, ambiguous matches, ZIP mismatches, and invalid points", async () => {
  const fetcher = vi.fn().mockImplementation(() => response());
  expect(await resolveStoreCoordinates({ address: "Atlanta, GA 30307" }, { fetcher })).toBeNull();
  expect(await resolveStoreCoordinates({ address: "Online catalog · ZIP 30307" }, { fetcher })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  for (const matches of [[], [match, match], [{ ...match, addressComponents: { zip: "99999" } }],
    [{ ...match, coordinates: { x: -84, y: 999 } }]]) {
    expect(await resolveStoreCoordinates({ address }, { fetcher: vi.fn().mockImplementation(() => response(matches)) })).toBeNull();
  }
});

it("handles unavailable/malformed geocoders and honors cancellation", async () => {
  for (const fetcher of [vi.fn().mockResolvedValue(new Response("Unavailable", { status: 503 })),
    vi.fn().mockResolvedValue(new Response("not json")), vi.fn().mockRejectedValue(new Error("network"))])
    expect(await resolveStoreCoordinates({ address }, { fetcher })).toBeNull();
  await expect(resolveStoreCoordinates({ address }, { signal: AbortSignal.abort() })).rejects.toThrow();
});

it("recovers address-only mapped stores before distance and coverage filtering", async () => {
  const fetcher = vi.fn().mockImplementation(() => response());
  vi.stubGlobal("fetch", fetcher);
  const data = await resolveMappedLocations({ osm3s: { timestamp_osm_base: "2026-10-10" }, elements: [
    { type: "node", id: 1, tags: { name: "Kroger", shop: "supermarket", "addr:full": address } },
    { type: "way", id: 2, lat: 10, center: { lat: 33.756, lon: -84.348 }, tags: { name: "Target", shop: "supermarket" } },
  ] });
  const places = normalizePlaces(data, "downtown", 5, "grocery", { lat: 33.756, lon: -84.348, label: "Atlanta" }).places;
  expect(places).toHaveLength(2);
  expect(places.map(place => [place.lat, place.lon])).toEqual([[33.756, -84.348], [33.756, -84.348]]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
