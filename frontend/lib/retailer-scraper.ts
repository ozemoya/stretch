import type { AgentItem, StoreCheck } from "./price-agent";
import type { StoreCoverage } from "./retailer-coverage";
import type { NearbyPlace } from "./live-data";
import type { SearchPlan } from "./local-search-agent";
import type { ScrapeReport, ScrapeContext } from "./scrapers/types";
import { scraperRegistry } from "./scrapers";
import { normalizeCatalogReport } from "./product-ownership";
import { resolveStoreCoordinates, validStoreCoordinates } from "./store-coordinates.mjs";
export type { ScrapedProduct, ScrapeReport } from "./scrapers/types";
export { parseLidlProducts } from "./scrapers/lidl";

export async function scrapeRetailers(
  stores: StoreCoverage[], items: AgentItem[], places: NearbyPlace[] = [],
  plan?: SearchPlan, signal?: AbortSignal, onReport?: (report: ScrapeReport) => void,
  options: { zip?: string; fast?: boolean } = {},
): Promise<ScrapeReport[]> {
  const reports: ScrapeReport[] = [];
  for (const retailer of new Set(stores.map(store => store.retailer))) {
    signal?.throwIfAborted();
    const emit = (report: ScrapeReport) => {
      if (!signal?.aborted) onReport?.(normalizeCatalogReport(report, items));
    };
    let report: ScrapeReport;
    try {
      report = await scraperRegistry.get(retailer).scrape({
        retailer, stores: stores.filter(store => store.retailer === retailer), items, places,
        zip: options.zip ?? "", plan, signal, fast: options.fast, onReport: emit,
      });
    } catch (error) {
      signal?.throwIfAborted();
      report = { retailer, status: "failed", detail: "Retailer search failed. No price was assumed.",
        lines: items.map(item => ({ item, products: [], searchStatus: "error" })) };
    }
    report = normalizeCatalogReport(report, items);
    reports.push(report);
    emit(report);
  }
  return reports;
}

export async function scrapeBranches(context: Omit<ScrapeContext, "retailer">) {
  const stores: StoreCheck[] = [], warnings: string[] = [];
  for (const retailer of new Set(context.stores.map(store => store.retailer))) {
    const adapter = scraperRegistry.get(retailer);
    if (!adapter.checkBranches) continue;
    context.signal?.throwIfAborted();
    try {
      const checked = await adapter.checkBranches({ ...context, retailer,
        stores: context.stores.filter(store => store.retailer === retailer) });
      stores.push(...await Promise.all(checked.map(async store => {
        const mapped = context.stores.find(row => row.id === store.id && row.retailer === retailer);
        const pair = validStoreCoordinates(store.coordinates?.lat, store.coordinates?.lon) ? store.coordinates : mapped;
        const point = await resolveStoreCoordinates({ latitude: pair?.lat,
          longitude: pair?.lon, address: store.address || mapped?.address }, { signal: context.signal });
        if (!point) warnings.push(`${store.name} could not be located from its coordinates or street address.`);
        return { ...store, ...(point ? { coordinates: { lat: point.latitude, lon: point.longitude } } : {}) };
      })));
    } catch {
      context.signal?.throwIfAborted();
      warnings.push(retailer + " branch price search failed. Affected stores remain unpriced.");
    }
  }
  return { stores, warnings };
}
