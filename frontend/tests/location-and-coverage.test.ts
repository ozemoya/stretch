import { afterEach, expect, it, vi } from "vitest";
import { normalizeIpLocation, detectLocation, detectDeviceLocation } from "../lib/detect-location";
import { parseOrigin } from "../lib/locations";
import { publicIp, POST } from "../app/api/location/route";
import { groceryCoverage } from "../lib/retailer-coverage";
import { normalizePlaces } from "../lib/live-data";
import { normalizeFeed } from "../lib/grocery-feed";
import { reviewedTotal } from "../lib/price-agent";
afterEach(() => vi.unstubAllGlobals());
const city = {
  success: true,
  city: "New York",
  region: "New York",
  country: "United States",
  latitude: 40.7128,
  longitude: -74.006,
  postal: "10007",
  ip: "do-not-return",
};
it("keeps arbitrary visitor coordinates and strips provider IP/network details", () => {
  expect(normalizeIpLocation(city)).toEqual({
    lat: 40.713,
    lon: -74.006,
    label: "New York, New York, United States",
    source: "ip",
    zip: "10007",
  });
  expect(() => normalizeIpLocation({ ...city, latitude: 100 })).toThrow();
  expect(() => normalizeIpLocation({ ...city, success: false })).toThrow();
});
it("uses device coordinates and reports the browser's accuracy only after a location request", async () => {
  const getCurrentPosition = vi.fn((success) => success({ coords: {
    latitude: 33.7487521, longitude: -84.3876844, accuracy: 17.4,
  } }));
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  expect(await detectDeviceLocation()).toEqual({
    lat: 33.7487521, lon: -84.3876844, label: "Your device location",
    source: "device", accuracyMeters: 17,
  });
  expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
});
it("keeps the prior area usable when device permission is denied", async () => {
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (_success: unknown, error: (value: {code: number}) => void) => error({ code: 1 }) } });
  await expect(detectDeviceLocation()).rejects.toThrow("Location permission was denied");
});
it("uses a fresh device position for automatic detection without contacting IP providers", async () => {
  const getCurrentPosition = vi.fn((success) => success({ coords: {
    latitude: 40.7128123, longitude: -74.0060456, accuracy: 8,
  } }));
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(await detectLocation(new AbortController().signal)).toEqual({
    lat: 40.7128123, lon: -74.0060456, label: "Your device location",
    source: "device", accuracyMeters: 8,
  });
  expect(getCurrentPosition).toHaveBeenCalledWith(expect.any(Function), expect.any(Function),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 });
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([1, 2, 3])("requires manual selection on device-location failure %s without falling back to IP", async (code) => {
  vi.stubGlobal("navigator", { geolocation: {
    getCurrentPosition: (_success: unknown, error: (value: { code: number }) => void) => error({ code }),
  } });
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(detectLocation(new AbortController().signal)).rejects.toThrow(/manually/);
  expect(fetcher).not.toHaveBeenCalled();
});
it("requires manual selection when the browser has no location service", async () => {
  vi.stubGlobal("navigator", {});
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(detectLocation(new AbortController().signal)).rejects.toThrow(/unavailable/);
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not request a position for an already cancelled lookup", async () => {
  const getCurrentPosition = vi.fn();
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  const controller = new AbortController(); controller.abort();
  await expect(detectLocation(controller.signal)).rejects.toThrow(/cancelled/);
  expect(getCurrentPosition).not.toHaveBeenCalled();
});
it("ignores a late device position after cancelling the lookup", async () => {
  const getCurrentPosition = vi.fn();
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  const controller = new AbortController();
  const lookup = detectLocation(controller.signal);
  controller.abort();
  getCurrentPosition.mock.calls[0][0]({ coords: { latitude: 33.7, longitude: -84.3, accuracy: 10 } });
  await expect(lookup).rejects.toThrow(/cancelled/);
});
it.each([
  { latitude: 91, longitude: 0, accuracy: 10 },
  { latitude: 0, longitude: NaN, accuracy: 10 },
  { latitude: 0, longitude: 0, accuracy: -1 },
])("rejects unusable device coordinates or accuracy", async (coords) => {
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition: (success: (value: unknown) => void) => success({ coords }) } });
  await expect(detectLocation(new AbortController().signal)).rejects.toThrow(/usable location/);
});
it("rejects malformed coordinates and internal addresses before any provider lookup", async () => {
  expect(() => parseOrigin(new URLSearchParams("lat=0&lon="))).toThrow();
  expect(() => parseOrigin(new URLSearchParams("lat=91&lon=0"))).toThrow();
  expect(parseOrigin(new URLSearchParams("lat=0&lon=0"))).toMatchObject({
    lat: 0,
    lon: 0,
  });
  for (const ip of [
    "127.0.0.1",
    "10.0.0.2",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "https://example.com",
  ])
    expect(publicIp(ip)).toBe(false);
  expect(publicIp("8.8.8.8")).toBe(true);
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect(
    (
      await POST(
        new Request("http://localhost/api/location", {
          method: "POST",
          body: JSON.stringify({ ip: "127.0.0.1" }),
        }),
      )
    ).status,
  ).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
});
it("retains more than 60 grocery locations and every retailer in an arbitrary city", () => {
  const names = [
    "Walmart",
    "Publix",
    "ALDI",
    "Target",
    "Whole Foods Market",
    "Trader Joe's",
    "Neighborhood Grocery",
  ];
  const data = {
    osm3s: { timestamp_osm_base: "2026-10-09" },
    elements: Array.from({ length: 80 }, (_, id) => ({
      type: "node",
      id,
      lat: 40.7128,
      lon: -74.006,
      tags: { name: names[id % names.length], shop: "supermarket" },
    })),
  };
  const places = normalizePlaces(
    data,
    "downtown",
    1,
    "grocery",
    normalizeIpLocation(city),
  ).places;
  expect(places).toHaveLength(80);
  const coverage = groceryCoverage(places);
  expect(new Set(coverage.map((c) => c.retailer)).size).toBe(7);
  expect(coverage.every((c) => c.status === "unavailable")).toBe(true);
});
it("rejects partial map query responses rather than claiming every store was found", () => {
  expect(() =>
    normalizePlaces(
      {
        remark: "Query timed out",
        osm3s: { timestamp_osm_base: "2026-10-09" },
        elements: [],
      },
      "downtown",
    ),
  ).toThrow(/did not finish/);
});
it("accepts only local store IDs and fresh in-store USD price feed packages", () => {
  const place = {
    id: "node/1",
    name: "Independent store",
    kind: "grocery" as const,
    address: "",
    miles: 1,
    lat: 0,
    lon: 0,
    mapUrl: "https://www.openstreetmap.org/node/1",
  };
  const items = [{ id: "milk", name: "Milk", unit: "1 gal", quantity: 2 }];
  const offer = {
    id: "p",
    name: "Milk",
    brand: "Brand",
    size: "1 gal",
    soldBy: "UNIT",
    regularCents: 400,
    retrievedAt: "2026-10-09T12:00:00Z",
    retailerId: "Independent / other retailer",
    storeLocationId: "node/1",
    productUrl: "https://local.example/products/milk",
  };
  const raw = {
    source: "Test fixture",
    currency: "USD",
    priceType: "in_store",
    stores: [
      {
        id: "node/1",
        lines: [
          {
            itemId: "milk",
            candidates: [
              offer,
              { ...offer, id: "old", retrievedAt: "2026-10-01T12:00:00Z" },
              { ...offer, id: "future", retrievedAt: "2026-11-01T12:00:00Z" },
            ],
          },
        ],
      },
      { id: "node/999", lines: [] },
    ],
  };
  const result = normalizeFeed(
    raw,
    groceryCoverage([place]),
    items,
    new Date("2026-10-09T14:00:00Z"),
  );
  expect(result.stores).toHaveLength(1);
  expect(result.stores[0].lines[0].candidates).toHaveLength(1);
  expect(reviewedTotal(result.stores[0], { milk: "p" })).toBe(800);
  const wrongRetailer = normalizeFeed(
    {
      ...raw,
      stores: [
        {
          id: "node/1",
          lines: [
            {
              itemId: "milk",
              candidates: [
                {
                  ...offer,
                  productUrl:
                    "https://www.instacart.com/store/aldi/products/123",
                },
              ],
            },
          ],
        },
      ],
    },
    groceryCoverage([place]),
    items,
    new Date("2026-10-09T14:00:00Z"),
  );
  expect(wrongRetailer.stores[0].lines[0].candidates).toEqual([]);
  expect(() =>
    normalizeFeed(
      { ...raw, priceType: "delivery" },
      groceryCoverage([place]),
      items,
    ),
  ).toThrow();
  expect(() =>
    normalizeFeed({ ...raw, currency: "EUR" }, groceryCoverage([place]), items),
  ).toThrow();
});
