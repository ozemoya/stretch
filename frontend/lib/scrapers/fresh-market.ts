import { freshMarketObservedReport, freshMarketSpecials } from "../fresh-market-specials";
import { mergeCatalogReports } from "../merge-catalog-reports";
import type { RetailerScraper } from "./types";

export const freshMarketScraper: RetailerScraper = {
  id: "fresh-market",
  async scrape({ places, items, signal }) {
    const observed = freshMarketObservedReport(places, items);
    try {
      return mergeCatalogReports(observed, await freshMarketSpecials(places, items, signal));
    } catch {
      signal?.throwIfAborted();
      return { ...observed, detail: `${observed.detail} Weekly offer source could not be retrieved.` };
    }
  },
};
