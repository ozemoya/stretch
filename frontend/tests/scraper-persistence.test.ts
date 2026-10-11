import { afterEach, expect, it, vi } from "vitest";
import { catalogPriceBatch, branchPriceBatch, locationKey, savePriceBatch } from "../lib/scrapers/persistence";
import type { ScrapeReport } from "../lib/retailer-scraper";
import type { StoreCheck } from "../lib/price-agent";
const now = Date.parse("2026-10-10T12:00:00Z");
afterEach(() => vi.unstubAllGlobals());
const item = { id: "milk", name: "Milk", unit: "1 gallon", quantity: 1 };
const product = { id: "p", name: "Milk", brand: "Target", size: "1 gallon", priceCents: 349,
  sourceUrl: "https://www.target.com/p/milk", retrievedAt: new Date(now).toISOString() };
const report: ScrapeReport = { retailer: "Target", status: "retrieved", detail: "Official catalog",
  lines: [{ item, products: [product, { ...product, id: "cheaper", priceCents: 299 },
    { ...product, id: "small", priceCents: 99, size: "16 fl oz" },
    { ...product, id: "wrong-store", priceCents: 49, sourceUrl: "https://www.walmart.com/ip/milk/1" }] }] };

it("saves the lowest matching package with its source and does not invent branch ownership", () => {
  const batch = catalogPriceBatch(report, "30303", now);
  expect(locationKey(batch.location)).toBe("target:catalog:zip:30303");
  expect(batch.location.lat).toBeUndefined();
  expect(batch.prices).toHaveLength(1);
  expect(batch.prices[0]).toMatchObject({ price_cents: 299, source_product_id: "cheaper", catalog_item_id: "milk", unit_basis: "fl oz" });
  expect(catalogPriceBatch(report, "30303", now + 86400001).prices).toEqual([]);
});

it("keeps native Kroger branches stable and separates other retailers with the same native ID", () => {
  const store: StoreCheck = { id: "node/1", sourceLocationId: "01100672", retailerId: "Kroger family", name: "Kroger Glenwood",
    address: "Atlanta", requestedItemIds: ["milk"], lines: [] };
  expect(locationKey(branchPriceBatch(store, [], now).location)).toBe("kroger:branch:1100672");
  expect(locationKey(branchPriceBatch({ ...store, retailerId: "Target" }, [], now).location)).toBe("target:branch:01100672");
  expect(locationKey(branchPriceBatch({ ...store, sourceLocationId: undefined }, [], now).location)).toBe("kroger:branch:osm:node/1");
});

it("saves atomically through the RPC and reports failures rather than claiming success", async () => {
  const batch = catalogPriceBatch(report, "30303", now);
  const rpc = vi.fn().mockResolvedValue({ data: [{ location_id: -1, product_id: -1 }], error: null });
  expect(await savePriceBatch(batch, { rpc } as never)).toEqual({ status: "saved", saved: 1 });
  expect(rpc).toHaveBeenCalledWith("save_store_prices", { p_location: batch.location, p_prices: batch.prices });
  rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  expect((await savePriceBatch(batch, { rpc } as never)).status).toBe("failed");
  expect((await savePriceBatch(batch, null)).status).toBe("unconfigured");
});

it("resolves a missing branch coordinate pair before saving and rejects unlocated branches", async () => {
  const batch = catalogPriceBatch(report, "30303", now);
  batch.location = { ...batch.location, scope: "branch", source_id: "osm:node/1", address: "800 Glenwood Ave SE, Atlanta, GA 30316" };
  const rpc = vi.fn().mockResolvedValue({ data: [{ product_id: -1 }], error: null });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Response.json({ result: { addressMatches: [{
    coordinates: { x: -84.35962, y: 33.742558 }, addressComponents: { zip: "30316" },
  }] } })));
  expect((await savePriceBatch(batch, { rpc })).status).toBe("saved");
  expect(rpc.mock.calls[0][1].p_location).toMatchObject({ lat: 33.742558, lon: -84.35962 });
  rpc.mockClear();
  batch.location.address = "";
  expect((await savePriceBatch(batch, { rpc })).status).toBe("failed");
  expect(rpc).not.toHaveBeenCalled();
});

it("reuses saved branch coordinates before geocoding an address", async () => {
  const batch = catalogPriceBatch(report, "30303", now);
  batch.location = { ...batch.location, scope: "branch", source_id: "osm:node/1", address: "800 Glenwood Ave SE, Atlanta, GA 30316" };
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const rpc = vi.fn().mockResolvedValue({ data: [{ product_id: -1 }], error: null });
  const storedLocation = vi.fn().mockResolvedValue({ latitude: 33.742558, longitude: -84.35962, address: batch.location.address });
  expect((await savePriceBatch(batch, { rpc, storedLocation })).status).toBe("saved");
  expect(storedLocation).toHaveBeenCalledWith("target:branch:osm:node/1");
  expect(rpc.mock.calls[0][1].p_location).toMatchObject({ lat: 33.742558, lon: -84.35962 });
  expect(fetcher).not.toHaveBeenCalled();
});
