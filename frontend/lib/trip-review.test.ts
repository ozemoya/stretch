import { describe, expect, it } from "vitest";
import type { CheckoutDraft } from "./checkout-draft";
import type { StoreCheck } from "./price-agent";
import { createTripReview, parseTripReview, readTripReview, writeTripReview } from "./trip-review";

const draft: CheckoutDraft = {
  version: 1, basket: [{ productId: "milk", quantity: 2 }],
  items: [{ id: "milk", name: "Milk", unit: "1 gallon", quantity: 2 }],
  prefs: { area: "midtown", budget: 20, mpg: 25, gas: 3.5, maxStops: 3, minExtraStopSavings: 5, shoppingPriority: "balanced",
    vegan: false, glutenFree: false, nutFree: false },
  origin: { lat: 33.78, lon: -84.38, label: "Midtown" }, ipArea: true,
  gasStop: { id: "pump-1", name: "Pump", address: "1 Main St", lat: 33.79,
    lon: -84.38, mapUrl: "https://www.openstreetmap.org/node/1" },
  fuelSource: null, manualGas: 3.5,
};
const store: StoreCheck = {
  id: "branch-1", retailerId: "retailer-1", name: "Market", address: "2 Main St",
  requestedItemIds: ["milk"], lines: [{ item: draft.items[0], candidates: [{
    id: "candidate-1", name: "Whole Milk", brand: "Market", size: "1 gallon", soldBy: "UNIT",
    regularCents: 399, retrievedAt: "2026-10-10T00:00:00Z", retailerId: "retailer-1",
    storeLocationId: "branch-1", productId: "sku-1", productName: "Whole Milk",
    price: 3.99, priceSource: "Retailer catalog", verifiedAt: "2026-10-10T00:00:00Z",
    productUrl: "https://example.com/milk",
  }] }],
};
const route = { miles: 10, minutes: 22 };
const storeLocation = { mapUrl: "https://www.openstreetmap.org/node/2", lat: 33.785, lon: -84.379 };

describe("trip review", () => {
  it("totals a complete branch basket and chosen gas stop", () => {
    const review = createTripReview(draft, store, { milk: "candidate-1" }, route, storeLocation)!;
    expect(review.groceryCents).toBe(798);
    expect(review.fuelCents).toBe(140);
    expect(review.totalCents).toBe(938);
    expect(review.gasStopId).toBe("pump-1");
    const entries = new Map<string, string>();
    const storage = { getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); } };
    expect(writeTripReview(storage, review)).toBe(true);
    expect(readTripReview(storage, draft)).toEqual(review);
  });

  it("rejects other-retailer prices and incomplete food selections", () => {
    expect(createTripReview(draft, { ...store, lines: [{ ...store.lines[0], candidates: [
      { ...store.lines[0].candidates[0], retailerId: "other" },
    ] }] }, { milk: "candidate-1" }, route, storeLocation)).toBeNull();
    expect(createTripReview(draft, store, {}, route, storeLocation)).toBeNull();
  });

  it("keeps a branch-verified price when its source supplies no product page", () => {
    const withoutLink = { ...store, lines: [{ ...store.lines[0], candidates: [
      { ...store.lines[0].candidates[0], productUrl: null },
    ] }] };
    const review = createTripReview(draft, withoutLink, { milk: "candidate-1" }, route, storeLocation);
    expect(review?.products[0].productUrl).toBeNull();
    expect(review?.groceryCents).toBe(798);
    expect(parseTripReview(review, draft)).toEqual(review);
  });

  it("invalidates changed stations, items, and altered totals", () => {
    const review = createTripReview(draft, store, { milk: "candidate-1" }, route, storeLocation)!;
    expect(parseTripReview({ ...review, totalCents: 1 }, draft)).toBeNull();
    expect(parseTripReview(review, { ...draft, gasStop: { ...draft.gasStop!, id: "pump-2" } })).toBeNull();
    expect(parseTripReview(review, { ...draft, items: [{ ...draft.items[0], quantity: 3 }] })).toBeNull();
    expect(createTripReview({ ...draft, gasStop: null }, store, { milk: "candidate-1" }, route, storeLocation)).toBeNull();
  });
});
