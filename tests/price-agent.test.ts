import { expect, it } from "vitest";
import { checkStores, reviewedTotal } from "../lib/price-agent";
import { areaFromIp } from "../lib/ip-area";
it("keeps failed searches incomplete and bounds store coverage", async () => {
  const stores = [1, 2, 3].map((n) => ({
    id: String(n),
    retailerId: "Test retailer",
    name: `Store ${n}`,
    address: "",
  }));
  const result = await checkStores(
    [{ id: "milk", name: "Milk", unit: "1 gal", quantity: 2 }],
    stores,
    async () => {
      throw new Error("offline");
    },
  );
  expect(result).toHaveLength(2);
  expect(result[0].lines[0].error).toBeTruthy();
  expect(reviewedTotal(result[0], {})).toBeNull();
});
it("requires reviewed priced unit packages before totaling quantities", async () => {
  const result = await checkStores(
    [{ id: "milk", name: "Milk", unit: "1 gal", quantity: 2 }],
    [{ id: "1", retailerId: "Test retailer", name: "Store", address: "" }],
    async () => [
      {
        id: "p",
        name: "Milk",
        brand: "",
        size: "1 gal",
        soldBy: "UNIT",
        regularCents: 300,
        retrievedAt: new Date().toISOString(),
        retailerId: "Test retailer",
        storeLocationId: "1",
        productId: "p",
        productName: "Milk",
        price: 3,
        priceSource: "Test source",
        verifiedAt: new Date().toISOString(),
        productUrl: "https://example.com/milk",
      },
    ],
  );
  expect(reviewedTotal(result[0], {})).toBeNull();
  expect(reviewedTotal(result[0], { milk: "p" })).toBe(600);
  result[0].lines[0].candidates[0].soldBy = "WEIGHT";
  expect(reviewedTotal(result[0], { milk: "p" })).toBeNull();
});
it("maps IP coordinates only to nearby supported areas", () => {
  expect(areaFromIp(33.783, -84.383)).toBe("midtown");
  expect(areaFromIp(33.7748, -84.2963)).toBe("decatur");
  expect(areaFromIp(40.7128, -74.006)).toBeNull();
  expect(areaFromIp(null, -84)).toBeNull();
  expect(areaFromIp(NaN, -84)).toBeNull();
});
