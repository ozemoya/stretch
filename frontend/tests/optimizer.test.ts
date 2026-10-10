import { describe, it, expect } from "vitest";
import { optimize, suggestSwaps } from "../lib/optimizer";
import sample from "../lib/sample-catalog.json";
import type { Preferences } from "../lib/types";
const p: Preferences = {
  area: "downtown",
  budget: 35,
  mpg: 25,
  gas: 3.5,
  maxStops: 2,
  vegan: false,
  glutenFree: false,
  nutFree: false,
};
const basket = sample.products
  .slice(0, 9)
  .map((x) => ({ productId: x.id, quantity: 1 }));
describe("trip optimization", () => {
  it("finds split-store savings and prices every selected package", () => {
    const trips = optimize(sample, basket, p);
    expect(trips[0].stops.length).toBe(2);
    expect(trips[0].totalCents).toBeLessThan(
      Math.min(
        ...trips.filter((t) => t.stops.length === 1).map((t) => t.totalCents),
      ),
    );
    expect(trips[0].stops.flatMap((s) => s.items).length).toBe(9);
    for (const t of trips) expect(t.totalCents).toBe(t.foodCents + t.fuelCents);
  });
  it("includes the return home in fuel and respects one-stop limits", () => {
    const trips = optimize(sample, basket, { ...p, maxStops: 1 });
    expect(trips.every((t) => t.stops.length === 1)).toBe(true);
    const a = trips.find((t) => t.id === "market-a")!;
    expect(a.miles).toBe(6);
    expect(a.fuelCents).toBe(84);
  });
  it("never ranks incomplete baskets above complete ones", () => {
    const trips = optimize(
      sample,
      [{ productId: "olive-oil", quantity: 1 }],
      p,
    );
    expect(trips[0].missing).toHaveLength(0);
    expect(trips.find((t) => t.id === "market-c")!.missing).toContain(
      "Olive oil",
    );
  });
  it("flags dietary conflicts and proposes reviewed vegan alternatives", () => {
    const b = [{ productId: "chicken", quantity: 2 }];
    const vegan = { ...p, vegan: true };
    expect(optimize(sample, b, vegan).every((t) => t.missing.length)).toBe(
      true,
    );
    const swaps = suggestSwaps(sample, b, vegan);
    expect(swaps[0].product.id).toBe("lentils");
    expect(swaps[0].updated[0].quantity).toBe(2);
    expect(swaps[0].after.missing).toHaveLength(0);
  });
  it("handles empty lists and rejects invalid fuel inputs", () => {
    expect(optimize(sample, [], p)).toEqual([]);
    expect(() => optimize(sample, basket, { ...p, mpg: 0 })).toThrow();
    expect(() => optimize(sample, basket, { ...p, gas: NaN })).toThrow();
  });
  it("offers sequential swaps when several dietary conflicts exist", () => {
    const suggestions = suggestSwaps(sample, basket, { ...p, vegan: true });
    expect(suggestions.map((s) => s.fromId)).toEqual(
      expect.arrayContaining(["milk", "eggs", "chicken"]),
    );
    expect(suggestions.every((s) => s.savings === null)).toBe(true);
  });
  it("accounts for quantities in food cost", () => {
    const one = optimize(sample, [{ productId: "rice", quantity: 1 }], {
      ...p,
      maxStops: 1,
    });
    const three = optimize(sample, [{ productId: "rice", quantity: 3 }], {
      ...p,
      maxStops: 1,
    });
    for (const t of one)
      expect(three.find((x) => x.id === t.id)!.foodCents).toBe(t.foodCents * 3);
  });
  it("uses measured station detour miles and the selected pump price in the total", () => {
    const routes = { "market-a": { miles: 12, minutes: 25 } };
    const [trip] = optimize(
      sample,
      [{ productId: "rice", quantity: 1 }],
      { ...p, maxStops: 1, gas: 3.25 },
      routes,
      true,
    );
    expect(trip.id).toBe("market-a");
    expect(trip.miles).toBe(12);
    expect(trip.fuelCents).toBe(Math.round((12 / p.mpg) * 3.25 * 100));
    expect(trip.totalCents).toBe(trip.foodCents + trip.fuelCents);
    expect(
      optimize(sample, [{ productId: "rice", quantity: 1 }], p, {}, true),
    ).toEqual([]);
  });
});
