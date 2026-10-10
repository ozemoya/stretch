import { expect, it, vi } from "vitest";
const address = "1225 Caroline St NE, Atlanta, GA 30307";
const krogerStores = vi.hoisted(() => vi.fn());
vi.mock("../lib/live-data", () => ({ krogerConfigured: () => true, krogerStores, krogerProducts: vi.fn() }));
vi.mock("../lib/price-agent", () => ({ checkStores: async (_items: unknown, stores: unknown[]) => stores.map(store => ({ ...store as object, lines: [] })) }));
import { krogerScraper } from "../lib/scrapers/kroger";
it("matches a geocoded Kroger branch by its exact full address and keeps mapped coordinates", async () => {
  krogerStores.mockResolvedValue([{ id: "01100461", name: "Kroger Edgewood", address,
    coordinateSource: "census-address", coordinates: { lat: 33.7584566, lon: -84.3481328 } }]);
  const stores = await krogerScraper.checkBranches!({ retailer: "Kroger family", zip: "30307", places: [], items: [],
    stores: [{ id: "node/1", retailer: "Kroger family", name: "Kroger", address, lat: 33.754, lon: -84.348,
      miles: 1, mapUrl: "", status: "unavailable", detail: "" }] });
  expect(stores).toHaveLength(1);
  expect(stores[0]).toMatchObject({ sourceLocationId: "01100461", coordinates: { lat: 33.754, lon: -84.348 } });
  krogerStores.mockResolvedValue([{ id: "01100461", name: "Kroger", address, coordinateSource: "explicit",
    coordinates: { lat: 33.7584566, lon: -84.3481328 } }]);
  expect(await krogerScraper.checkBranches!({ retailer: "Kroger family", zip: "30307", places: [], items: [],
    stores: [{ id: "node/1", retailer: "Kroger family", name: "Kroger", address, lat: 33.754, lon: -84.348,
      miles: 1, mapUrl: "", status: "unavailable", detail: "" }] })).toEqual([]);
});
