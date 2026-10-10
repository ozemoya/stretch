import { describe, expect, it } from "vitest";
import {
  CHECKOUT_DRAFT_KEY,
  parseCheckoutDraft,
  readCheckoutDraft,
  writeCheckoutDraft,
  type CheckoutDraft,
} from "./checkout-draft";

const draft: CheckoutDraft = {
  version: 1,
  basket: [{ productId: "milk", quantity: 2 }],
  items: [{ id: "milk", name: "Milk", unit: "gallon", quantity: 2 }],
  prefs: {
    area: "midtown", budget: 35, mpg: 25, gas: 3.5, maxStops: 2,
    vegan: false, glutenFree: false, nutFree: false,
  },
  origin: { lat: 33.783, lon: -84.383, label: "Midtown", zip: "30309" },
  ipArea: true,
  gasStop: null,
  fuelSource: null,
  manualGas: 3.5,
};

describe("checkout trip handoff", () => {
  it("keeps the selected list and location when navigating to results", () => {
    const entries = new Map<string, string>();
    const storage = {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); },
    };
    expect(writeCheckoutDraft(storage, draft)).toBe(true);
    expect(entries.has(CHECKOUT_DRAFT_KEY)).toBe(true);
    expect(readCheckoutDraft(storage)).toEqual(draft);
    // Clearing step one must replace the saved trip, not restore old food on refresh.
    expect(writeCheckoutDraft(storage, { ...draft, basket: [], items: [] })).toBe(true);
    expect(readCheckoutDraft(storage)?.basket).toEqual([]);
  });

  it("rejects an incomplete or mismatched saved trip", () => {
    expect(parseCheckoutDraft({ ...draft, basket: [] })).toBeNull();
    expect(parseCheckoutDraft({ ...draft, items: [{ ...draft.items[0], id: "eggs" }] })).toBeNull();
    expect(readCheckoutDraft({ getItem: () => "{broken" })).toBeNull();
  });
});
