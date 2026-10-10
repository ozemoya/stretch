import { expect, it } from "vitest";
import { normalizeCatalogReport } from "../lib/product-ownership";
import { nearbyAlternatives } from "../lib/nearby-alternatives";
import {
  boundedJobStatus,
  catalogLineStatus,
  SearchEpoch,
  settlePendingReports,
} from "../lib/search-state";
import {
  pricedItemCount,
  reviewedTotal,
  checkStores,
  type Candidate,
  type StoreCheck,
} from "../lib/price-agent";

const milk = { id: "milk", name: "Milk", unit: "1 gallon", quantity: 1 };
const eggs = { id: "eggs", name: "Eggs", unit: "12 ct", quantity: 1 };
function candidate(
  retailerId: string,
  storeLocationId: string,
  productId: string,
  cents: number,
): Candidate {
  return {
    id: productId,
    productId,
    productName: "Whole Milk",
    name: "Whole Milk",
    brand: "",
    size: "1 gallon",
    soldBy: "UNIT",
    regularCents: cents,
    price: cents / 100,
    retailerId,
    storeLocationId,
    priceSource: "Authorized test feed",
    verifiedAt: "2026-10-10T12:00:00Z",
    retrievedAt: "2026-10-10T12:00:00Z",
    productUrl: `https://example.com/${productId}`,
    upc: productId,
  };
}
function store(
  retailerId: string,
  id: string,
  products: Candidate[],
): StoreCheck {
  return {
    retailerId,
    id,
    name: retailerId,
    address: `${id} Main St`,
    requestedItemIds: ["milk", "eggs"],
    lines: [
      { item: milk, candidates: products },
      { item: eggs, candidates: [] },
    ],
  };
}

it("never attributes an ALDI catalog URL to Kroger, Walmart, or Whole Foods", () => {
  const listing = {
    id: "milk-1",
    name: "Whole Milk",
    brand: "ALDI",
    size: "1 gallon",
    priceCents: 399,
    sourceUrl: "https://www.instacart.com/store/aldi/products/123",
    retrievedAt: "2026-10-10T12:00:00Z",
  };
  for (const retailer of ["Kroger family", "Walmart", "Whole Foods"]) {
    const report = normalizeCatalogReport({
      retailer,
      status: "retrieved",
      detail: "Catalog",
      lines: [{ item: milk, products: [listing], searchStatus: "completed" }],
    });
    expect(report.lines[0].products).toEqual([]);
    expect(report.lines[0].searchStatus).toBe("price_unavailable");
    expect(report.status).toBe("failed");
  }
  expect(
    normalizeCatalogReport({
      retailer: "ALDI",
      status: "retrieved",
      detail: "Catalog",
      lines: [{ item: milk, products: [listing] }],
    }).lines[0].products[0],
  ).toMatchObject({
    retailerId: "ALDI",
    storeLocationId: null,
    productId: "milk-1",
    price: 3.99,
    productUrl: listing.sourceUrl,
  });
});

it("keeps missing items and foreign retailer prices out of branch totals", () => {
  const kroger = store("Kroger family", "kroger-1", [
    candidate("ALDI", "aldi-1", "wrong", 199),
    candidate("Kroger family", "kroger-1", "right", 399),
  ]);
  expect(pricedItemCount(kroger)).toBe(1);
  expect(reviewedTotal(kroger, { milk: "wrong", eggs: "none" })).toBeNull();
  expect(reviewedTotal(kroger, { milk: "right" })).toBeNull();
  kroger.lines.pop();
  expect(reviewedTotal(kroger, { milk: "right" })).toBeNull();
});

it("groups and deduplicates cheaper alternatives at their actual branch", () => {
  const kroger = store("Kroger family", "kroger-1", [
    candidate("Kroger family", "kroger-1", "selected", 499),
  ]);
  const aldiProduct = candidate("ALDI", "aldi-1", "upc-123", 399);
  const aldi = store("ALDI", "aldi-1", [
    aldiProduct,
    { ...aldiProduct, id: "duplicate", productId: "duplicate", upc: "upc-123" },
  ]);
  const wholeFoods = store("Whole Foods", "whole-1", [
    candidate("ALDI", "aldi-1", "foreign", 299),
  ]);
  const result = nearbyAlternatives([kroger, aldi, wholeFoods], {
    "kroger-1": { milk: "selected" },
  });
  expect(result).toHaveLength(1);
  expect(result[0].store.id).toBe("aldi-1");
  expect(result[0].savingsCents).toBe(100);
});

it("settles expired searches and ignores results from an older request", () => {
  const start = 1_000_000;
  expect(boundedJobStatus("running", start, start + 240_000)).toBe("timeout");
  expect(
    catalogLineStatus(
      {
        retailer: "ALDI",
        status: "failed",
        detail: "",
        lines: [{ item: milk, products: [], searchStatus: "timeout" }],
      },
      "milk",
    ),
  ).toBe("timeout");
  const epoch = new SearchEpoch();
  const first = epoch.begin();
  const second = epoch.begin();
  expect(epoch.isCurrent(first)).toBe(false);
  expect(epoch.isCurrent(second)).toBe(true);
  epoch.cancel();
  expect(epoch.isCurrent(second)).toBe(false);
});

it("records a timed-out branch item as terminal instead of searching forever", async () => {
  const checked = await checkStores(
    [milk],
    [
      {
        id: "kroger-1",
        retailerId: "Kroger family",
        name: "Kroger",
        address: "1 Main St",
      },
    ],
    async () => {
      throw new Error("Request timed out");
    },
  );
  expect(checked[0].lines[0].searchStatus).toBe("timeout");
  expect(checked[0].lines[0].candidates).toEqual([]);
});

it("cancels obsolete branch searches before starting another item", async () => {
  const controller = new AbortController();
  let calls = 0;
  await expect(
    checkStores(
      [milk, eggs],
      [
        {
          id: "kroger-1",
          retailerId: "Kroger family",
          name: "Kroger",
          address: "1 Main St",
        },
      ],
      async () => {
        calls++;
        controller.abort();
        return [];
      },
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(calls).toBe(1);
});

it("turns streaming and refresh failures into terminal line states", () => {
  const pending = {
    retailer: "ALDI",
    status: "pending" as const,
    detail: "",
    lines: [{ item: milk, products: [], searchStatus: "searching" as const }],
  };
  const settled = settlePendingReports([pending], "timeout");
  expect(settled[0].status).toBe("failed");
  expect(settled[0].lines[0].searchStatus).toBe("timeout");
});
