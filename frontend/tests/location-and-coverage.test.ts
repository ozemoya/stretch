import { afterEach, expect, it, vi } from "vitest";
import { normalizeIpLocation, detectLocation } from "../lib/detect-location";
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
    zip: "10007",
  });
  expect(() => normalizeIpLocation({ ...city, latitude: 100 })).toThrow();
  expect(() => normalizeIpLocation({ ...city, success: false })).toThrow();
});
it("falls back to the visitor IP when direct browser geolocation fails", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("CORS"))
    .mockResolvedValueOnce(Response.json({ ip: "8.8.8.8" }))
    .mockResolvedValueOnce(Response.json(normalizeIpLocation(city)));
  vi.stubGlobal("fetch", fetcher);
  expect((await detectLocation(new AbortController().signal)).lat).toBe(
    40.713,
  );
  expect(fetcher.mock.calls[2][0]).toBe("/api/location");
  expect(JSON.parse(fetcher.mock.calls[2][1].body)).toEqual({ ip: "8.8.8.8" });
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
