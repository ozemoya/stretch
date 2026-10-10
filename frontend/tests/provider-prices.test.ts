import { describe, it, expect } from "vitest";
import {
  parseProviderProducts,
  matchesRequestedFood,
} from "../lib/provider-prices";
describe("provider price validation", () => {
  it("rejects unrelated search results instead of treating them as eggs", () => {
    expect(matchesRequestedFood("Eggo Minis Pancake Bites", "eggs")).toBe(
      false,
    );
    expect(matchesRequestedFood("Lunchables Turkey and Cheese", "eggs")).toBe(
      false,
    );
    expect(matchesRequestedFood("Large white egg", "eggs")).toBe(true);
  });
  it("reads gallon abbreviation in the provider's package description", () => {
    expect(
      parseProviderProducts(
        [
          {
            title: "Publix Milk, Whole",
            description: "Publix Whole Milk 1 gl JUG",
            price: "$3.67",
            store_country: "us",
            url: "https://www.instacart.com/store/publix/products/324942-publix-milk-whole-1-ea",
          },
        ],
        "www.instacart.com",
      )[0]?.size,
    ).toBe("1 gallon");
  });
  const product = {
    product_id: "1",
    product_name: "Whole milk",
    final_price: 3.29,
    currency: "USD",
    url: "https://www.walmart.com/ip/milk/1",
    specifications: [{ name: "Net weight", value: "1 gallon" }],
  };
  it("keeps the package price instead of a per-unit comparison rate", () => {
    expect(
      parseProviderProducts(
        [{ ...product, unit_price: 0.03 }],
        "www.walmart.com",
      )[0],
    ).toMatchObject({ priceCents: 329, size: "1 gallon" });
  });
  it("accepts explicitly USD formatted prices without losing package validation", () => {
    expect(
      parseProviderProducts(
        [{ ...product, final_price: "$3.29" }],
        "www.walmart.com",
      )[0]?.priceCents,
    ).toBe(329);
  });
  it("reads the verified US Instacart response without assuming a local branch price", () => {
    const record = {
      title: "Publix Eggs, Large",
      price: "$2.43",
      store_country: "us",
      url: "https://www.instacart.com/store/publix/products/324877-publix-eggs-large-12-ct",
      availability: "in_stock",
    };
    expect(
      parseProviderProducts([record], "www.instacart.com")[0],
    ).toMatchObject({ priceCents: 243, size: "12 ct" });
    expect(
      parseProviderProducts(
        [
          { ...record, store_country: "ca" },
          { ...record, availability: "out_of_stock" },
          { ...record, currency: "CAD" },
        ],
        "www.instacart.com",
      ),
    ).toEqual([]);
  });
  it("does not attribute another retailer's Instacart page to a store", () => {
    const record = {
      title: "Whole Milk",
      price: 3.99,
      currency: "USD",
      url: "https://www.instacart.com/store/publix/products/324942-publix-milk-whole-1-gal",
      size_unit: "1 gal",
    };
    expect(
      parseProviderProducts(
        [record],
        "www.instacart.com",
        "2026-10-10T00:00:00Z",
        "The Fresh Market",
      ),
    ).toEqual([]);
  });
  it("rejects discovery-only URLs, currency mismatch, hostile URLs and ambiguous packages", () => {
    expect(
      parseProviderProducts(
        [
          { url: product.url },
          { ...product, currency: "CAD" },
          { ...product, url: "https://www.walmart.com.evil.test/ip/milk/1" },
          { ...product, specifications: [] },
          { ...product, variants: [{}, {}] },
          { ...product, error: "failed" },
        ],
        "www.walmart.com",
      ),
    ).toEqual([]);
  });
});
