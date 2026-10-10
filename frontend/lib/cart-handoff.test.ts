import { describe, expect, it } from "vitest";
import type { TripReview } from "./trip-review";
import { canCreateInstacartList, copyableShoppingList, instacartLineItems, retailerShoppingUrl, shopifyCartUrl } from "./cart-handoff";

const review: TripReview = {
  version: 1, draftKey: "key", createdAt: "2026-10-10T00:00:00Z",
  retailerId: "ALDI", storeLocationId: "aldi-1", storeName: "ALDI", storeAddress: "1 Main St", storeMapUrl: "https://www.openstreetmap.org/node/2", storeLat: 33.785, storeLon: -84.379,
  products: [{ itemId: "milk", requestedName: "Milk", quantity: 2, retailerId: "ALDI",
    storeLocationId: "aldi-1", productId: "16902710", productName: "Whole Milk",
    packageSize: "1 gal", unitPriceCents: 399, lineTotalCents: 798,
    productUrl: "https://www.instacart.com/store/aldi/products/16902710-friendly-farms-vitamin-d-milk-1-gal",
    priceSource: "branch quote", verifiedAt: "2026-10-10T00:00:00Z" }],
  gasStopId: "pump-1", gasPrice: 3.5, gasPriceReported: false, mpg: 25, miles: 10,
  minutes: 22, groceryCents: 798, fuelCents: 140, totalCents: 938,
};

describe("retailer handoff", () => {
  it("keeps the chosen retailer and product quantity in an Instacart list", () => {
    expect(retailerShoppingUrl(review)).toBe("https://www.instacart.com/store/aldi");
    expect(canCreateInstacartList(review)).toBe(true);
    expect(instacartLineItems(review)).toEqual([{ name: "Whole Milk",
      line_item_measurements: [{ quantity: 2, unit: "each" }], product_ids: [16902710] }]);
    expect(copyableShoppingList(review)).toContain("2 × Whole Milk");
  });
  it("refuses to mix retailers into a handoff", () => {
    const mixed = { ...review, products: [...review.products,
      { ...review.products[0], itemId: "eggs", productUrl: "https://www.instacart.com/store/publix/products/123-eggs" }] };
    expect(retailerShoppingUrl(mixed)).toBeNull();
    expect(canCreateInstacartList(mixed)).toBe(false);
  });
  it("does not claim a cart or shop link when the price source lacks a product URL", () => {
    const noLink = { ...review, products: [{ ...review.products[0], productUrl: null }] };
    expect(retailerShoppingUrl(noLink)).toBeNull();
    expect(shopifyCartUrl(noLink)).toBeNull();
    expect(canCreateInstacartList(noLink)).toBe(false);
    expect(copyableShoppingList(noLink)).toContain("2 × Whole Milk (1 gal)");
  });
  it("preloads an exact Shopify cart only with variant IDs from one merchant", () => {
    const shop = { ...review, products: [
      { ...review.products[0], itemId: "milk", productUrl: "https://local-grocer.myshopify.com/products/whole-milk?variant=123456789" },
      { ...review.products[0], itemId: "eggs", quantity: 1, productUrl: "https://local-grocer.myshopify.com/products/eggs?variant=987654321" },
    ] };
    expect(shopifyCartUrl(shop)).toBe("https://local-grocer.myshopify.com/cart/123456789:2,987654321:1?storefront=true");
    expect(shopifyCartUrl({ ...shop, products: [
      shop.products[0], { ...shop.products[1], productUrl: "https://other.myshopify.com/products/eggs?variant=987654321" },
    ] })).toBeNull();
    expect(shopifyCartUrl({ ...shop, products: [{ ...shop.products[0], productUrl: "https://local-grocer.myshopify.com/products/whole-milk" }] })).toBeNull();
    expect(shopifyCartUrl({ ...shop, products: [{ ...shop.products[0], productUrl: "https://local-grocer.myshopify.com:8443/products/whole-milk?variant=123456789" }] })).toBeNull();
    expect(shopifyCartUrl({ ...shop, products: [{ ...shop.products[0], productUrl: "https://www.walmart.com/products/whole-milk?variant=123456789" }] })).toBeNull();
  });
});
