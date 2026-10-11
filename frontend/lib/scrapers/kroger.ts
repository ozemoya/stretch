import { krogerConfigured, krogerProducts, krogerStores } from "../live-data";
import { checkStores } from "../price-agent";
import type { RetailerScraper } from "./types";

export const krogerScraper: RetailerScraper = {
  id: "kroger",
  async scrape({ retailer, items }) {
    return { retailer, status: "unsupported", lines: items.map(item => ({ item, products: [] })),
      detail: "Kroger uses its branch-specific Products API. Prices appear in the matched physical store results." };
  },
  async checkBranches({ stores: coverage, items, zip, signal }) {
    if (!krogerConfigured()) return [];
    const stores = await krogerStores(zip);
    signal?.throwIfAborted();
    const addressKey = (address: string) => address.toLowerCase().replace(/[,\s]+/g, " ").trim();
    const matched = stores.flatMap(store => {
      if (!store.coordinates) return [];
      const row = coverage.find(c => c.status !== "checked" && c.retailer === "Kroger family" &&
        ((Math.abs(c.lat - store.coordinates!.lat) < 0.001 && Math.abs(c.lon - store.coordinates!.lon) < 0.001) ||
          (store.coordinateSource === "census-address" && !!c.address && addressKey(c.address) === addressKey(store.address))));
      return row ? [{ ...store, coordinates: store.coordinateSource === "census-address"
        ? { lat: row.lat, lon: row.lon } : store.coordinates, retailerId: "Kroger family", coverageId: row.id }] : [];
    });
    const checked = await checkStores(items.slice(0, 10), matched, krogerProducts, signal);
    return checked.map(store => {
      const source = matched.find(entry => entry.id === store.id)!;
      return { ...store, id: source.coverageId, sourceLocationId: store.id, coordinates: source.coordinates,
        lines: [
          ...store.lines.map(line => ({ ...line, candidates: line.candidates
            .filter(candidate => candidate.storeLocationId === store.id && candidate.retailerId === "Kroger family")
            .map(candidate => ({ ...candidate, storeLocationId: source.coverageId })) })),
          ...items.slice(10).map(item => ({ item, candidates: [], error: "Not checked in this run due to provider request limits." })),
        ] };
    });
  },
};
