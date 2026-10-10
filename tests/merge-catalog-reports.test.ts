import { expect, it } from "vitest";
import { mergeCatalogReports } from "../lib/merge-catalog-reports";
import type { ScrapeReport } from "../lib/retailer-scraper";

const item = { id: "milk", name: "Milk", unit: "1 gal", quantity: 1 };
const observed = {
  id: "1",
  name: "Whole Milk",
  brand: "The Fresh Market",
  size: "1 gal",
  priceCents: 499,
  sourceUrl: "https://shop.thefreshmarket.com/milk",
  retrievedAt: "2026-10-10T04:00:00Z",
};
const base: ScrapeReport = {
  retailer: "The Fresh Market",
  status: "retrieved",
  detail: "In-store observation.",
  lines: [{ item, products: [observed] }],
};
it("preserves an in-store observation while full-catalog collection runs and refreshes prices", () => {
  const pending: ScrapeReport = {
    retailer: base.retailer,
    status: "pending",
    detail: "Full catalog search.",
    lines: [
      {
        item,
        products: [],
        error: "Collection running. Refresh to check existing work.",
      },
    ],
  };
  const combined = mergeCatalogReports(base, pending);
  expect(combined.lines[0].products).toEqual([observed]);
  expect(combined.lines[0].error).toMatch(/running/);
  const ready = mergeCatalogReports(combined, {
    ...pending,
    status: "retrieved",
    lines: [
      {
        item,
        products: [
          { ...observed, priceCents: 479 },
          {
            ...observed,
            id: "2",
            sourceUrl: "https://www.instacart.com/milk",
            priceCents: 399,
          },
        ],
      },
    ],
  });
  expect(ready.lines[0].products.map((product) => product.priceCents)).toEqual([
    479, 399,
  ]);
  expect(ready.lines[0].error).toBeUndefined();
  expect(ready.detail.match(/Full catalog search/g)).toHaveLength(1);
});
