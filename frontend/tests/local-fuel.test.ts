import { afterEach, describe, it, expect, vi } from "vitest";
import {
  localFuel,
  localFuelConfigured,
  normalizeLocalFuel,
} from "../lib/live-data";
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("only enables Places when both the server key and opt-in are set", () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    vi.stubEnv("GOOGLE_PLACES_ENABLED", "true");
    expect(localFuelConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "server-key");
    vi.stubEnv("GOOGLE_PLACES_ENABLED", "false");
    expect(localFuelConfigured()).toBe(false);
    vi.stubEnv("GOOGLE_PLACES_ENABLED", "true");
    expect(localFuelConfigured()).toBe(true);
  });

  it("queries Google Places on the server for the requested fuel type and radius", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "server-key");
    vi.stubEnv("GOOGLE_PLACES_ENABLED", "true");
    const fetchMock = vi.fn(async () =>
      Response.json({ places: [station("atlanta-station", [price()])] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await localFuel("downtown", 3, "REGULAR_UNLEADED");
    expect(result.stations[0].dollarsPerGallon).toBe(3.459);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://places.googleapis.com/v1/places:searchNearby");
    expect(options.headers).toMatchObject({
      "X-Goog-Api-Key": "server-key",
    });
    expect(JSON.parse(options.body as string)).toMatchObject({
      includedTypes: ["gas_station"],
      locationRestriction: { circle: { radius: 4828.032 } },
    });
  });

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
      lat: 33.749,
      lon: -84.388,
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
