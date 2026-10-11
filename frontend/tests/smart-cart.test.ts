import { describe, expect, it } from "vitest";
import { addCartLine, cartGroups, cartLine, cartSubtotal, readCart, replacementOptions, replaceCartLine, writeCart } from "../lib/smart-cart";
import { fuelCostCents } from "../lib/live-trip";
import type { AgentItem, Candidate, StoreCheck } from "../lib/price-agent";
import type { StoreCoverage } from "../lib/retailer-coverage";

const at = "2026-10-10T12:00:00.000Z";
const store = (id: string, retailerId: string): StoreCheck => ({ id, retailerId, name: retailerId,
  address: `${id} Main St`, requestedItemIds: [], lines: [] });
const location = (id: string): StoreCoverage => ({ id, name: id, address: `${id} Main St`,
  lat: 33.75, lon: -84.39, mapUrl: "https://example.com/map", miles: 1, retailer: id,
  status: "checked", detail: "" });
const item = (name: string): AgentItem => ({ id: name, name, unit: "1 each", quantity: 1 });
const product = (id: string, retailerId: string, storeLocationId: string, cents: number): Candidate => ({
  id, name: id, brand: retailerId, size: "1 each", soldBy: "UNIT", regularCents: cents,
  retrievedAt: at, retailerId, storeLocationId, productId: id, productName: id, price: cents / 100,
  priceSource: "Illustrative test fixture", verifiedAt: at, productUrl: "https://example.com/product",
});

describe("Smart Cart ownership and totals", () => {
  it("does not assign an ALDI listing to Walmart", () => {
    expect(cartLine(item("Eggs"), product("eggs", "aldi", "aldi-1", 249),
      store("walmart-1", "walmart"), location("walmart-1"), at)).toBeNull();
  });
  it("keeps the example's two store subtotals separate and calculates driving fuel", () => {
    const aldi = store("aldi-1", "aldi"), walmart = store("walmart-1", "walmart");
    const lines = [
      cartLine(item("Large Eggs"), product("eggs", "aldi", "aldi-1", 249), aldi, location(aldi.id), at)!,
      cartLine(item("Whole Milk"), product("milk", "aldi", "aldi-1", 319), aldi, location(aldi.id), at)!,
      cartLine(item("Chicken Wings"), product("wings", "walmart", "walmart-1", 899), walmart, location(walmart.id), at)!,
      cartLine(item("Parboiled Rice"), product("rice", "walmart", "walmart-1", 449), walmart, location(walmart.id), at)!,
    ];
    expect(cartGroups(lines).map(({ subtotalCents }) => subtotalCents)).toEqual([568, 1348]);
    expect(cartSubtotal(lines)).toBe(1916);
    expect(fuelCostCents(12, 20, 4)).toBe(240);
    expect(cartSubtotal(lines) + fuelCostCents(12, 20, 4)!).toBe(2156);
  });
  it("deduplicates the same verified listing and persists valid lines", () => {
    const aldi = store("aldi-1", "aldi");
    const line = cartLine(item("Large Eggs"), product("eggs", "aldi", aldi.id, 249), aldi, location(aldi.id), at)!;
    const next = addCartLine([line], line);
    expect(next).toHaveLength(1);
    expect(next[0].quantity).toBe(2);
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    expect(writeCart(storage, next)).toBe(true);
    expect(readCart(storage)).toEqual(next);
  });
  it("excludes deselected items and their branch from totals and routing groups", () => {
    const aldi = store("aldi-1", "aldi"), walmart = store("walmart-1", "walmart");
    const egg = cartLine(item("Eggs"), product("eggs", "aldi", aldi.id, 249), aldi, location(aldi.id), at)!;
    const rice = cartLine(item("Rice"), product("rice", "walmart", walmart.id, 449), walmart, location(walmart.id), at)!;
    const lines = [egg, { ...rice, selected: false }];
    expect(cartSubtotal(lines)).toBe(249);
    expect(cartGroups(lines).map((group) => group.store.id)).toEqual([aldi.id]);
  });
  it("replaces only with a verified listing for the same requested item", () => {
    const aldi = store("aldi-1", "aldi"), walmart = store("walmart-1", "walmart");
    const first = cartLine(item("Eggs"), product("eggs-a", "aldi", aldi.id, 249), aldi, location(aldi.id), at)!;
    const cheaper = cartLine(item("Eggs"), product("eggs-w", "walmart", walmart.id, 199), walmart, location(walmart.id), at)!;
    const differentFood = cartLine(item("Rice"), product("rice", "walmart", walmart.id, 149), walmart, location(walmart.id), at)!;
    expect(replacementOptions(first, [first, cheaper, differentFood])).toEqual([cheaper]);
    expect(replaceCartLine([first], first.id, cheaper)).toMatchObject([{ id: cheaper.id, quantity: 1 }]);
    expect(replaceCartLine([first], first.id, differentFood)).toEqual([first]);
  });
  it("keeps older guest carts selected when the selection field is absent", () => {
    const aldi = store("aldi-1", "aldi");
    const line = cartLine(item("Eggs"), product("eggs", "aldi", aldi.id, 249), aldi, location(aldi.id), at)!;
    const { selected: _selected, ...legacy } = line;
    const storage = { getItem: () => JSON.stringify([legacy]) };
    expect(readCart(storage)[0].selected).toBe(true);
  });
});
