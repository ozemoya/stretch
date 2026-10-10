import { expect, it } from "vitest";
import { buildMultiStorePlan, eligibleMultiStoreOptions } from "../lib/multi-store-plan";
import type { AgentItem, Candidate, StoreCheck } from "../lib/price-agent";

const items: AgentItem[] = [
  { id: "milk", name: "Milk", unit: "1 gallon", quantity: 2 },
  { id: "eggs", name: "Eggs", unit: "12 ct", quantity: 1 },
];
function candidate(retailerId: string, storeLocationId: string, item: AgentItem, cents: number): Candidate {
  return { id: `${storeLocationId}-${item.id}`, productId: `${storeLocationId}-${item.id}`,
    productName: item.name, name: item.name, brand: "", size: item.unit, soldBy: "UNIT",
    regularCents: cents, price: cents / 100, retailerId, storeLocationId,
    priceSource: "Test retailer feed", verifiedAt: "2026-10-10T12:00:00Z", retrievedAt: "2026-10-10T12:00:00Z",
    productUrl: `https://example.com/${storeLocationId}-${item.id}` };
}
function store(id: string, retailerId: string, cents: number[]): StoreCheck {
  return { id, retailerId, name: retailerId, address: `${id} Main St`, requestedItemIds: items.map((item) => item.id),
    lines: items.map((item, index) => ({ item, candidates: [candidate(retailerId, id, item, cents[index])] })) };
}

it("builds separate lists and sums only verified products at their own branches", () => {
  const aldi = store("aldi-1", "ALDI", [300, 400]);
  const kroger = store("kroger-1", "Kroger", [500, 250]);
  const plan = buildMultiStorePlan(items, [aldi, kroger], {
    milk: { storeId: aldi.id, candidateId: "aldi-1-milk" },
    eggs: { storeId: kroger.id, candidateId: "kroger-1-eggs" },
  });
  expect(plan?.lists.map((list) => [list.store.id, list.subtotalCents])).toEqual([["aldi-1", 600], ["kroger-1", 250]]);
  expect(plan?.groceryCents).toBe(850);
  expect(buildMultiStorePlan(items, [aldi, kroger], { milk: { storeId: aldi.id, candidateId: "aldi-1-milk" } })).toBeNull();
  expect(buildMultiStorePlan(items, [aldi, kroger], {
    milk: { storeId: kroger.id, candidateId: "aldi-1-milk" }, eggs: { storeId: kroger.id, candidateId: "kroger-1-eggs" },
  })).toBeNull();
  expect(eligibleMultiStoreOptions(items[0], [kroger]).map((option) => option.product.retailerId)).toEqual(["Kroger"]);
});
