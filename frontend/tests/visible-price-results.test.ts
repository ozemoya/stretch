import { expect, it } from "vitest";
import { hasVisibleCatalogPrice, hasVisibleBranchPrice } from "../lib/visible-price-results";
import type { ScrapeReport } from "../lib/retailer-scraper";
import type { StoreCheck } from "../lib/price-agent";

const item = { id: "milk", name: "milk", unit: "gallon", quantity: 1 };

it("hides a retailer with no owned verified catalog price", () => {
  const report: ScrapeReport = {
    retailer: "Walmart", status: "retrieved", detail: "Catalog",
    lines: [{ item, products: [{
      id: "aldi-milk", name: "Milk", brand: "ALDI", size: "1 gallon",
      priceCents: 329, sourceUrl: "https://www.instacart.com/store/aldi/products/123",
      retrievedAt: "2026-10-10T12:00:00Z",
    }] }],
  };
  expect(hasVisibleCatalogPrice(report)).toBe(false);
  expect(hasVisibleCatalogPrice({ ...report, retailer: "ALDI" })).toBe(true);
  expect(hasVisibleCatalogPrice({ ...report, retailer: "ALDI", status: "blocked" })).toBe(false);
  expect(hasVisibleCatalogPrice({ ...report, lines: [] })).toBe(false);
});

it("hides a mapped branch until that branch has its own priced product", () => {
  const store: StoreCheck = {
    id: "branch-1", retailerId: "Example Market", name: "Example Market",
    address: "1 Main St", requestedItemIds: [item.id],
    lines: [{ item, candidates: [] }],
  };
  expect(hasVisibleBranchPrice(store)).toBe(false);
});
