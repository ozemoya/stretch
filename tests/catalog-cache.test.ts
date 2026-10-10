import { expect, it } from "vitest";
import { CatalogCache } from "../lib/catalog-cache";
import type { ScrapeReport } from "../lib/retailer-scraper";

const at = Date.parse("2026-10-10T12:00:00Z");
const item = { id: "milk", name: "milk", unit: "gallon", quantity: 1 };
const report: ScrapeReport = { retailer: "ALDI", status: "retrieved", detail: "Retailer catalog", lines: [{ item,
  products: [{ id: "1", name: "Milk", brand: "ALDI", size: "1 gallon", priceCents: 329,
    sourceUrl: "https://www.instacart.com/store/aldi/products/1", retrievedAt: new Date(at).toISOString() }] }] };

it("reuses evidence across basket IDs and quantities without changing timestamps", () => {
  const cache = new CatalogCache();
  cache.put("30303", report, at);
  const result = cache.read("30303", [{ ...item, id: "new-id", quantity: 3 }], at + 1000);
  expect(result[0].lines[0].item.quantity).toBe(3);
  expect(result[0].lines[0].item.id).toBe("new-id");
  expect(result[0].lines[0].products[0].retrievedAt).toBe(new Date(at).toISOString());
  expect(result[0].lines[0].products[0].storeLocationId).toBeNull();
});

it("does not mix regions, package requests, dietary words, or retailers", () => {
  const cache = new CatalogCache();
  cache.put("30303", report, at);
  cache.put("30303", { ...report, retailer: "Kroger family" }, at);
  expect(cache.read("30309", [item], at)).toEqual([]);
  expect(cache.read("30303", [{ ...item, name: "organic milk" }], at)).toEqual([]);
  expect(cache.read("30303", [{ ...item, unit: "half gallon" }], at)).toEqual([]);
  expect(cache.read("30303", [item], at).map(report => report.retailer)).toEqual(["ALDI"]);
  expect(cache.read("30303", [item], at + 300_001)).toEqual([]);
});
