import type { RetailerScraper } from "./types";

const key = (name: string) => name.trim().toLowerCase().replace(/[’‘]/g, "'");

/** Explicit registration keeps selection deterministic; a store library always wins. */
export function createScraperRegistry(
  fallback: RetailerScraper,
  entries: ReadonlyArray<readonly [string, RetailerScraper]>,
) {
  const adapters = new Map<string, RetailerScraper>();
  for (const [retailer, adapter] of entries) {
    if (adapters.has(key(retailer))) throw new Error(`Duplicate scraper: ${retailer}`);
    adapters.set(key(retailer), adapter);
  }
  return { get: (retailer: string) => adapters.get(key(retailer)) ?? fallback };
}
