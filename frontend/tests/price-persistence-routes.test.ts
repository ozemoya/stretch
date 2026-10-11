import { beforeEach, expect, it, vi } from "vitest";
import type { ScrapeReport } from "../lib/retailer-scraper";

const deferred = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", () => ({ after: (callback: () => Promise<void>) => deferred.push(callback) }));
vi.mock("../lib/scrapers/persistence", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/scrapers/persistence")>(),
  savePriceBatch: vi.fn(async () => ({ status: "saved", saved: 1 })),
}));
vi.mock("../lib/provider-prices", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/provider-prices")>(),
  providerReports: vi.fn(),
}));
vi.mock("../lib/retailer-scraper", () => ({ scrapeRetailers: vi.fn() }));
vi.mock("../lib/live-data", () => ({
  googleNearbyPlaces: vi.fn(), krogerConfigured: () => true,
  krogerStores: vi.fn(), krogerProducts: vi.fn(),
  errorResponse: (error: Error) => Response.json({ error: error.message }, { status: 502 }),
}));
vi.mock("../lib/grocery-feed", () => ({ groceryFeed: async () => null }));
vi.mock("../lib/trader-joes", () => ({ traderJoesObserved: () => [] }));
vi.mock("../lib/local-search-agent", () => ({ planBasketSearch: async () => null }));
vi.mock("../lib/catalog-cache", () => ({ catalogCache: { read: () => [], put: () => {} } }));

import { POST as search } from "../app/api/agent/search/route";
import { POST as refresh } from "../app/api/live/provider-status/route";
import { POST as compare } from "../app/api/live/compare/route";
import { providerReports } from "../lib/provider-prices";
import { scrapeRetailers } from "../lib/retailer-scraper";
import { googleNearbyPlaces, krogerStores, krogerProducts } from "../lib/live-data";
import { locationKey, savePriceBatch } from "../lib/scrapers/persistence";

const item = { id: "milk", name: "Milk", unit: "1 gallon", quantity: 1 };
const request = (extra = {}) => new Request("http://localhost/api/prices", {
  method: "POST", body: JSON.stringify({ zip: "30303", items: [item], retailers: ["Target"], ...extra }),
});
beforeEach(() => {
  deferred.length = 0;
  vi.clearAllMocks();
  const at = new Date().toISOString();
  const report: ScrapeReport = { retailer: "Target", status: "retrieved", detail: "Official catalog",
    lines: [{ item, products: [{ id: "milk-1", name: "Milk", brand: "Target", size: "1 gallon",
      priceCents: 349, sourceUrl: "https://www.target.com/p/milk", retrievedAt: at }] }] };
  vi.mocked(providerReports).mockImplementation(async (_retailers, _items, _zip, _start, _cacheOnly, onReport) => {
    onReport?.(report);
    return [report];
  });
  vi.mocked(scrapeRetailers).mockImplementation(async (_stores, _items, _places, _plan, _signal, onReport) => {
    onReport?.(report);
    return [report];
  });
  vi.mocked(googleNearbyPlaces).mockResolvedValue({ origin: { label: "Atlanta" }, places: [
    { id: "node/1", name: "Kroger", kind: "grocery", lat: 33.75, lon: -84.39, address: "Atlanta", miles: 1, mapUrl: "" },
    { id: "node/2", name: "Target", kind: "grocery", lat: 33.76, lon: -84.39, address: "Atlanta", miles: 2, mapUrl: "" },
  ] } as never);
  vi.mocked(krogerStores).mockResolvedValue([{ id: "01100672", name: "Kroger", address: "Atlanta",
    coordinates: { lat: 33.75, lon: -84.39 } }]);
  vi.mocked(krogerProducts).mockResolvedValue([{ id: "milk-2", productId: "milk-2", name: "Milk",
    locationId: "01100672", upc: "", promoCents: null,
    productName: "Milk", brand: "Kroger", size: "1 gallon", soldBy: "UNIT", regularCents: 299,
    price: 2.99, retrievedAt: at, verifiedAt: at, priceSource: "Kroger API", productUrl: null,
    retailerId: "Kroger family", storeLocationId: "01100672" }]);
});

async function savedKeys(response: Response) {
  expect(response.status).toBe(200);
  await response.text();
  expect(savePriceBatch).not.toHaveBeenCalled();
  for (const callback of deferred) await callback();
  return vi.mocked(savePriceBatch).mock.calls.map(([batch]) => locationKey(batch.location));
}

it("persists streamed search catalogs and native branches after the response", async () => {
  expect(await savedKeys(await search(request()))).toEqual([
    "target:catalog:zip:30303", "kroger:branch:1100672",
  ]);
  const branch = vi.mocked(savePriceBatch).mock.calls[1][0];
  expect(branch.prices[0]).toMatchObject({ price_cents: 299, source_product_id: "milk-2" });
});

it.each([false, true])("persists provider refresh prices with stream=%s", async stream => {
  expect(await savedKeys(await refresh(request({ stream })))).toEqual(["target:catalog:zip:30303"]);
});

it("persists direct comparisons using the same catalog and branch identities", async () => {
  expect(await savedKeys(await compare(request()))).toEqual([
    "target:catalog:zip:30303", "kroger:branch:1100672",
  ]);
});
