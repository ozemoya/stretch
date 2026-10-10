import { expect, it } from "vitest";
import { optimizeMixMatch, priceSelections, bestRoadRoute, type RoadMatrix } from "../lib/mix-match-optimizer";
import type { AgentItem, Candidate, StoreCheck } from "../lib/price-agent";

const items: AgentItem[] = [
  { id: "eggs", name: "Eggs", unit: "12 ct", quantity: 1 },
  { id: "milk", name: "Milk", unit: "1 gallon", quantity: 1 },
  { id: "rice", name: "Rice", unit: "2 lb", quantity: 1 },
];
function store(id: string, prices: (number | null)[]): StoreCheck {
  return { id, retailerId: id, name: id, address: `${id} Main St`, requestedItemIds: items.map((item) => item.id),
    lines: items.map((item, index) => ({ item, candidates: prices[index] === null ? [] : [{
      id: `${id}-${item.id}`, productId: `${id}-${item.id}`, productName: item.name, name: item.name,
      brand: id, size: item.unit, soldBy: "UNIT", regularCents: prices[index], price: prices[index]! / 100,
      retailerId: id, storeLocationId: id, priceSource: "Verified branch feed",
      verifiedAt: "2026-10-10T12:00:00Z", retrievedAt: "2026-10-10T12:00:00Z",
      productUrl: `https://example.com/${id}/${item.id}`,
    } satisfies Candidate] })) };
}
function matrix(ids: string[], distanceKm = 1): RoadMatrix {
  const n = ids.length + 1;
  return { storeIds: ids, hasFuelStop: false,
    distances: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : distanceKm * 1000)),
    durations: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 0 : 300)) };
}
const prefs = { maxStores: 3, minNetSavingsCents: 500, priority: "balanced" as const, mpg: 25, gasPrice: 3.5 };

it("uses up to three stores only when each extra stop clears the $5 net threshold", () => {
  const stores = [store("A", [100, 1000, 1000]), store("B", [1000, 100, 1000]), store("C", [1000, 1000, 100])];
  const result = optimizeMixMatch(items, stores, matrix(["A", "B", "C"]), prefs);
  expect(result.baseline?.storeIds).toHaveLength(1);
  expect(result.cheapest?.storeIds).toHaveLength(3);
  expect(result.recommended?.storeIds).toHaveLength(3);
  expect(result.cheapest!.totalCents).toBeLessThan(result.baseline!.totalCents - 1000);
  expect(optimizeMixMatch(items, stores, matrix(["A", "B", "C"]), { ...prefs, maxStores: 2 }).cheapest?.storeIds.length).toBe(2);
});

it("does not mistake cheaper individual items for a cheaper trip when the extra drive costs more", () => {
  const stores = [store("A", [500, 500, 500]), store("B", [450, 450, 450])];
  const road = matrix(["A", "B"]);
  road.distances = [[0, 1000, 50000], [1000, 0, 50000], [50000, 50000, 0]];
  const result = optimizeMixMatch(items, stores, road, { ...prefs, minNetSavingsCents: 0 });
  expect(result.cheapest?.storeIds).toEqual(["A"]);
});

it("never fills missing items with another store's price or returns an incomplete plan", () => {
  const stores = [store("A", [500, null, 500]), store("B", [500, null, 500])];
  const result = optimizeMixMatch(items, stores, matrix(["A", "B"]), prefs);
  expect(result.unresolved).toEqual(["milk"]);
  expect(result.recommended).toBeNull();
});

it("reorders three stores by road distance and recalculates manual assignments", () => {
  const stores = [store("A", [100, 500, 500]), store("B", [500, 100, 500]), store("C", [500, 500, 100])];
  const road = matrix(["A", "B", "C"]);
  road.distances = [[0, 1000, 9000, 9000], [1000, 0, 1000, 8000], [9000, 8000, 0, 1000], [9000, 8000, 1000, 0]];
  const route = bestRoadRoute(["C", "B", "A"], road);
  expect(route?.order).toEqual(["A", "B", "C"]);
  const selections = Object.fromEntries(items.map((item, i) => [item.id,
    { storeId: stores[i].id, candidateId: `${stores[i].id}-${item.id}` }]));
  const plan = priceSelections(items, stores, selections, road, 25, 3.5, 3);
  expect(plan?.routeOrder).toEqual(["A", "B", "C"]);
  expect(plan?.groceryCents).toBe(300);
  expect(priceSelections(items, stores, selections, road, 25, 3.5, 2)).toBeNull();
});
