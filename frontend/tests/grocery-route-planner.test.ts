import { expect, it } from "vitest";
import { compareGroceryTrips } from "../lib/grocery-route-planner";
import { bestRoadRoute, roadRouteForOrder, type RoadMatrix } from "../lib/mix-match-optimizer";
import { cartLine } from "../lib/smart-cart";
import type { Candidate, AgentItem, StoreCheck } from "../lib/price-agent";
import type { StoreCoverage } from "../lib/retailer-coverage";

const at = "2026-10-10T12:00:00.000Z";
const item: AgentItem = { id: "milk", name: "Milk", unit: "1 gallon", quantity: 1 };
function line(id: string, cents: number) {
  const store: StoreCheck = { id, retailerId: id, name: id, address: `${id} Main St`, requestedItemIds: [], lines: [] };
  const location: StoreCoverage = { id, name: id, retailer: id, address: store.address,
    lat: 33.75, lon: -84.39, mapUrl: "https://example.com/map", miles: 1, status: "checked", detail: "" };
  const product: Candidate = { id: `${id}-milk`, productId: `${id}-milk`, name: "Milk", productName: "Milk",
    brand: id, size: "1 gallon", soldBy: "UNIT", regularCents: cents, price: cents / 100,
    priceSource: "Test fixture", verifiedAt: at, retrievedAt: at, retailerId: id, storeLocationId: id,
    productUrl: `https://example.com/${id}/milk` };
  return cartLine(item, product, store, location, at)!;
}

const matrix: RoadMatrix = {
  storeIds: ["aldi", "nearby"], hasFuelStop: false,
  distances: [[0, 10_000, 3_000], [10_000, 0, 10_000], [3_000, 10_000, 0]],
  durations: [[0, 1050, 300], [1050, 0, 1050], [300, 1050, 0]],
};

it("offers a cheaper grocery trip and a faster nearby trip without inventing prices", () => {
  const aldi = line("aldi", 249), nearby = line("nearby", 449);
  const options = compareGroceryTrips([aldi], [nearby], matrix, 20, 3.50);
  expect(options.cheapest?.lines[0].store.id).toBe("aldi");
  expect(options.fastest?.lines[0].store.id).toBe("nearby");
  expect(options.fastest!.minutes).toBeLessThan(options.cheapest!.minutes);
  expect(options.cheapest!.minutes - options.fastest!.minutes).toBe(25);
  expect(options.fastest!.groceryCents - options.cheapest!.groceryCents).toBe(200);
});

it("does not use another product or store as a missing price", () => {
  const aldi = line("aldi", 249);
  const wrong = { ...line("nearby", 100), item: { ...item, id: "eggs" } };
  const options = compareGroceryTrips([aldi], [wrong], matrix, 20, 3.50);
  expect(options.fastest?.lines[0].store.id).toBe("aldi");
  expect(options.cheapest?.lines[0].store.id).toBe("aldi");
});

it("compares road distance and time independently and respects manual order", () => {
  const roads: RoadMatrix = { storeIds: ["a", "b"], hasFuelStop: false,
    distances: [[0, 1000, 5000], [5000, 0, 1000], [1000, 5000, 0]],
    durations: [[0, 900, 100], [100, 0, 900], [900, 100, 0]] };
  expect(bestRoadRoute(["a", "b"], roads, "distance")?.order).toEqual(["a", "b"]);
  expect(bestRoadRoute(["a", "b"], roads, "duration")?.order).toEqual(["b", "a"]);
  expect(roadRouteForOrder(["b", "a"], roads)?.order).toEqual(["b", "a"]);
});

it("does not quote a cheapest trip without a fuel estimate", () => {
  const result = compareGroceryTrips([line("aldi", 249)], [], matrix, 20, 0);
  expect(result.cheapest).toBeNull();
  expect(result.fastest?.totalCents).toBeNull();
});

it("includes the same priced fill-up shown in checkout totals", () => {
  const result = compareGroceryTrips([line("aldi", 249)], [line("nearby", 449)], matrix,
    20, 3.50, 3, 1200);
  expect(result.cheapest?.totalCents).toBe(result.cheapest!.groceryCents +
    result.cheapest!.fuelCents! + 1200);
  expect(result.fastest?.totalCents).toBe(result.fastest!.groceryCents +
    result.fastest!.fuelCents! + 1200);
});

it("does not recommend an extra store unless it meets the saved net-savings threshold", () => {
  const aldiMilk = line("aldi", 500);
  const aldiEggs = { ...line("aldi", 500), id: "eggs:aldi", item: { ...item, id: "eggs", name: "Eggs" } };
  const nearbyEggs = { ...line("nearby", 100), id: "eggs:nearby",
    item: { ...item, id: "eggs", name: "Eggs" } };
  const shortRoads: RoadMatrix = { storeIds: ["aldi", "nearby"], hasFuelStop: false,
    distances: [[0, 1000, 1000], [1000, 0, 1000], [1000, 1000, 0]],
    durations: [[0, 60, 60], [60, 0, 60], [60, 60, 0]] };
  const result = compareGroceryTrips([aldiMilk, aldiEggs], [nearbyEggs], shortRoads,
    25, 3.50, 3, 0, 500);
  expect(result.cheapest?.lines.every((entry) => entry.store.id === "aldi")).toBe(true);
});
