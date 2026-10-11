import { describe, expect, it } from "vitest";
import { addCatalogPick, catalogPick, catalogReferenceSubtotal, readCatalogPicks, writeCatalogPicks } from "../lib/catalog-picks";
import { cartSubtotal } from "../lib/smart-cart";
import type { OwnedCatalogProduct } from "../lib/product-ownership";

const product: OwnedCatalogProduct = {
  id: "123", productId: "123", name: "Whole Milk", productName: "Whole Milk", brand: "ALDI",
  size: "1 gallon", priceCents: 319, price: 3.19, sourceUrl: "https://www.instacart.com/store/aldi/products/123",
  productUrl: "https://www.instacart.com/store/aldi/products/123", retrievedAt: "2026-10-10T12:00:00.000Z",
  verifiedAt: "2026-10-10T12:00:00.000Z", priceSource: "Online catalog", retailerId: "ALDI", storeLocationId: null,
};
const item = { id: "milk", name: "Whole Milk", unit: "1 gallon", quantity: 1 };

describe("online catalog picks", () => {
  it("saves a retailer-owned listing without assigning a physical branch or trip price", () => {
    const pick = catalogPick(item, product)!;
    expect(pick.storeLocationId).toBeNull();
    expect(pick.onlinePriceCents).toBe(319);
    expect(cartSubtotal([])).toBe(0);
    expect(catalogReferenceSubtotal([pick])).toBe(319);
  });
  it("rejects a product URL belonging to another retailer", () => {
    expect(catalogPick(item, { ...product, productUrl: "https://www.instacart.com/store/publix/products/123" })).toBeNull();
  });
  it("deduplicates the same listing and persists the quantity", () => {
    const pick = catalogPick(item, product)!;
    const next = addCatalogPick([pick], pick);
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(2);
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(writeCatalogPicks(storage, next)).toBe(true);
    expect(readCatalogPicks(storage)).toEqual(next);
  });
});
