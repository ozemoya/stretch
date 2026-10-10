import type { StoreCheck } from "./price-agent";
import { pricedItemCount } from "./price-agent";
import type { ScrapeReport } from "./retailer-scraper";
import { ownedCatalogProducts } from "./product-ownership";

/** A store enters the comparison only after its own source yields a price. */
export function hasVisibleCatalogPrice(report: ScrapeReport): boolean {
  if (report.status !== "retrieved" && report.status !== "pending") return false;
  return report.lines.some(
    (line) => ownedCatalogProducts(report, line.products).length > 0,
  );
}

export function hasVisibleBranchPrice(store: StoreCheck): boolean {
  return pricedItemCount(store) > 0;
}
