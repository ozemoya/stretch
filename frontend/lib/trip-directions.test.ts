import { describe, expect, it } from "vitest";
import type { CheckoutDraft } from "./checkout-draft";
import type { TripReview } from "./trip-review";
import { tripDirectionsUrl } from "./trip-directions";

const draft = { origin: { lat: 33.78, lon: -84.38, label: "Midtown" },
  gasStop: { id: "gas-1", lat: 33.79, lon: -84.39 } } as CheckoutDraft;
const review = { storeLat: 33.785, storeLon: -84.375, gasStopId: "gas-1" } as TripReview;

describe("trip directions", () => {
  it("keeps the estimated stop order: grocery, selected gas, back to start", () => {
    const url = new URL(tripDirectionsUrl(draft, review)!);
    expect(url.origin).toBe("https://www.google.com");
    expect(url.searchParams.get("origin")).toBe("33.78,-84.38");
    expect(url.searchParams.get("waypoints")).toBe("33.785,-84.375|33.79,-84.39");
    expect(url.searchParams.get("destination")).toBe("33.78,-84.38");
  });
  it("refuses directions if the reviewed gas station changed", () => {
    expect(tripDirectionsUrl({ ...draft, gasStop: { ...draft.gasStop!, id: "other" } }, review)).toBeNull();
  });
});
