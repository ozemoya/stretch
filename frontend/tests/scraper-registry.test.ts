import { expect, it, vi } from "vitest";
import { createScraperRegistry } from "../lib/scrapers/registry";
import { parseGenericProducts } from "../lib/scrapers/default";
import type { RetailerScraper } from "../lib/scrapers/types";

it("selects a store library before the default, including typographic apostrophe aliases", () => {
  const fallback = { id: "default", scrape: vi.fn() } as RetailerScraper;
  const library = { id: "custom", scrape: vi.fn() } as RetailerScraper;
  const registry = createScraperRegistry(fallback, [["Trader Joe’s", library]]);
  expect(registry.get(" Trader Joe's ")).toBe(library);
  expect(registry.get("Unregistered store")).toBe(fallback);
  expect(() => createScraperRegistry(fallback, [["Store", library], ["store", library]])).toThrow("Duplicate");
});

const url = "https://www.target.com/p/milk/-/A-123";
const product = { "@type": "Product", sku: "milk", name: "Whole milk", size: "1 gallon",
  offers: { "@type": "Offer", price: "3.49", priceCurrency: "USD", url } };
const markup = (value: unknown) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

it("reads a standard product nested in JSON-LD without any store-specific selectors", () => {
  const result = parseGenericProducts(markup({ "@graph": [product] }), url, "Target", "milk");
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ name: "Whole milk", priceCents: 349, size: "1 gallon", sourceUrl: url });
});

it("rejects unrelated, ambiguous, cross-retailer, conditional, and non-USD prices", () => {
  for (const offers of [
    { "@type": "AggregateOffer", lowPrice: "1.00", priceCurrency: "USD" },
    { ...product.offers, priceCurrency: "EUR" },
    { ...product.offers, priceSpecification: { price: 1, referenceQuantity: "1 oz" } },
    { ...product.offers, validForMemberTier: "members" },
    { ...product.offers, url: "https://www.walmart.com/ip/milk/1" },
    { ...product.offers, availability: "https://schema.org/OutOfStock" },
    [product.offers, { ...product.offers, price: "2.00" }],
  ]) expect(parseGenericProducts(markup({ ...product, offers }), url, "Target", "milk")).toEqual([]);
  expect(parseGenericProducts(markup(product), url, "Target", "eggs")).toEqual([]);
  expect(parseGenericProducts(markup(product), "http://127.0.0.1", "Target", "milk")).toEqual([]);
  expect(parseGenericProducts(markup({ ...product, size: undefined }), url, "Target", "milk")).toEqual([]);
});
