import { describe, it, expect } from "vitest";
import { normalizeLocalFuel } from "../lib/live-data";
const now = new Date("2026-10-09T12:00:00Z");
const station = (id: string, prices: unknown[] = [], latitude = 33.749) => ({
  id,
  displayName: { text: id },
  formattedAddress: "Atlanta GA",
  googleMapsUri: `https://maps.google.com/?cid=${id}`,
  location: { latitude, longitude: -84.388 },
  fuelOptions: { fuelPrices: prices },
});
const price = (
  type = "REGULAR_UNLEADED",
  updateTime = "2026-10-09T11:00:00Z",
  currencyCode = "USD",
) => ({
  type,
  updateTime,
  price: { units: "3", nanos: 459000000, currencyCode },
});
describe("local station prices", () => {
  it("converts dollars and nanos, preserves report timestamps and sorts prices", () => {
    const r = normalizeLocalFuel(
      {
        places: [
          station("a", [price()]),
          station("b", [
            {
              ...price(),
              price: { units: "2", nanos: 999000000, currencyCode: "USD" },
            },
          ]),
        ],
      },
      "downtown",
      3,
      "REGULAR_UNLEADED",
      now,
    );
    expect(r.stations[0].id).toBe("b");
    expect(r.stations[1]).toMatchObject({
      dollarsPerGallon: 3.459,
      updatedAt: "2026-10-09T11:00:00Z",
      stale: false,
    });
  });
  it("does not fill missing regular prices with premium, foreign currencies or regional estimates", () => {
    const r = normalizeLocalFuel(
      {
        places: [
          station("premium", [price("PREMIUM")]),
          station("eur", [price("REGULAR_UNLEADED", undefined, "EUR")]),
          station("unknown"),
        ],
      },
      "downtown",
      3,
      "REGULAR_UNLEADED",
      now,
    );
    expect(
      r.stations.every((s) => s.dollarsPerGallon === null && s.stale),
    ).toBe(true);
  });
  it("excludes stations outside the requested radius before rounding", () => {
    expect(
      normalizeLocalFuel(
        { places: [station("near", [price()]), station("far", [price()], 34)] },
        "downtown",
        1,
        "REGULAR_UNLEADED",
        now,
      ).stations.map((s) => s.id),
    ).toEqual(["near"]);
  });
  it("marks old, unknown and future report times unusable", () => {
    const { updateTime, ...noTime } = price();
    const r = normalizeLocalFuel(
      {
        places: [
          station("old", [price("REGULAR_UNLEADED", "2026-10-06T11:00:00Z")]),
          station("future", [
            price("REGULAR_UNLEADED", "2026-10-10T12:00:00Z"),
          ]),
          station("unknown", [noTime]),
        ],
      },
      "downtown",
      3,
      "REGULAR_UNLEADED",
      now,
    );
    expect(r.stations.every((s) => s.stale)).toBe(true);
  });
});
