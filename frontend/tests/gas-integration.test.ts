import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveGasLocation, validGasLocationQuery } from "../lib/gas-location";
import { stationPriceForPlace } from "../lib/fuel-price-provider";
import { calculateGasSavings, milesFromRoadMatrix } from "../lib/gas-savings";
import { deduplicatePhysicalStations } from "../lib/gas-stations";
import type { LocalFuelResult } from "../lib/live-data";
import { GET as locationGET } from "../app/api/gas/location/route";
import { GET as detailsGET } from "../app/api/gas/details/route";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const report: LocalFuelResult = {
  area: "downtown", radiusMiles: 5, fuelType: "REGULAR_UNLEADED",
  source: "Google Maps", retrievedAt: "2026-10-10T12:00:00Z",
  stations: [{ id: "station-one", name: "Example Gas", address: "Atlanta, GA",
    lat: 33.75, lon: -84.39, miles: 1, mapUrl: "https://maps.google.com/?q=station-one",
    dollarsPerGallon: 3.59, updatedAt: "2026-10-10T11:00:00Z", stale: false,
    attributions: [] }],
};

describe("gas station identity and prices", () => {
  it("collapses duplicate physical listings but keeps a station's priced Place ID", () => {
    const base = { name: "Example Gas", kind: "fuel" as const, address: "5400 Main St, Atlanta, GA",
      lat: 33.75, lon: -84.39, miles: 1, mapUrl: "https://maps.google.com" };
    const found = deduplicatePhysicalStations([
      { ...base, id: "shop" }, { ...base, id: "pump", lat: 33.7501 },
      { ...base, id: "other", address: "5402 Main St, Atlanta, GA" },
    ], (place) => place.id === "pump");
    expect(found.map((place) => place.id)).toEqual(["pump", "other"]);
  });
  it("does not assign a chain's report to a different Place ID or location", () => {
    expect(stationPriceForPlace(report, "station-two", 33.75, -84.39)).toBeNull();
    expect(stationPriceForPlace(report, "station-one", 34.1, -84.39)).toBeNull();
    expect(stationPriceForPlace(report, "station-one", 33.75, -84.39)?.dollarsPerGallon).toBe(3.59);
  });
  it("treats stale or missing pump reports as unavailable", () => {
    expect(stationPriceForPlace({ ...report, stations: [{ ...report.stations[0], stale: true }] },
      "station-one", 33.75, -84.39)?.dollarsPerGallon).toBeNull();
  });
});

describe("road-based gas savings", () => {
  it("uses purchase prices and additional road fuel while measuring detour from the no-gas trip", () => {
    expect(calculateGasSavings({ gallonsNeeded: 10, mpg: 25, baselinePrice: 3.8,
      alternativePrice: 3.5, drivingFuelPrice: 3.5, noGasRouteMiles: 12,
      baselineRouteMiles: 14, alternativeRouteMiles: 16, maxDetourMiles: 3 })).toMatchObject({
      baselinePurchaseCents: 3800, alternativePurchaseCents: 3500,
      additionalDrivingFuelCents: 28, netSavingsCents: 272,
      detourMiles: 4, withinDistanceLimit: false,
    });
  });
  it("returns no savings without actual positive price and MPG inputs", () => {
    expect(calculateGasSavings({ gallonsNeeded: 10, mpg: 25, baselinePrice: 0,
      alternativePrice: 3.5, drivingFuelPrice: 3.5, noGasRouteMiles: 12,
      baselineRouteMiles: 14, alternativeRouteMiles: 16, maxDetourMiles: 3 })).toBeNull();
  });
  it("adds an optional station to grocery stop ordering and rejects missing road legs", () => {
    const metres = 1609.344;
    const matrix = [
      [0, 3 * metres, 4 * metres],
      [3 * metres, 0, 2 * metres],
      [4 * metres, 2 * metres, 0],
    ];
    expect(milesFromRoadMatrix(matrix, ["grocer"], null)).toBe(6);
    expect(milesFromRoadMatrix(matrix, ["grocer"], 2)).toBe(9);
    expect(milesFromRoadMatrix([[0, null], [null, 0]], [], 1)).toBeNull();
  });
});

describe("gas location search", () => {
  it("accepts ZIPs and complete addresses and rejects malformed ZIPs", () => {
    expect(validGasLocationQuery("30303")).toBe("30303");
    expect(validGasLocationQuery("1234")).toBeNull();
    expect(validGasLocationQuery("1 Peachtree St, Atlanta GA")).toBeTruthy();
  });
  it("returns Google coordinates and preserves the ZIP", () => {
    expect(resolveGasLocation({ places: [{ id: "place", formattedAddress: "Atlanta, GA 30303",
      location: { latitude: 33.75, longitude: -84.39 } }] }, "30303")).toEqual({
      lat: 33.75, lon: -84.39, label: "Atlanta, GA 30303", zip: "30303",
    });
  });
  it("handles missing credentials, provider errors, and timeouts", async () => {
    const url = "http://localhost/api/gas/location?q=30303";
    expect((await locationGET(new Request(url))).status).toBe(503);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key"); vi.stubEnv("GOOGLE_PLACES_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));
    expect((await locationGET(new Request(url))).status).toBe(429);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network timeout"); }));
    expect((await locationGET(new Request(url))).status).toBe(504);
  });
  it("only returns details matching the selected Google Place ID", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-key"); vi.stubEnv("GOOGLE_PLACES_ENABLED", "true");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "station-two" })));
    expect((await detailsGET(new Request("http://localhost/api/gas/details?id=station-one"))).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "station-one", rating: 4.2 })));
    const response = await detailsGET(new Request("http://localhost/api/gas/details?id=station-one"));
    expect(response.status).toBe(200);
    expect((await response.json()).details.rating).toBe(4.2);
  });
});
