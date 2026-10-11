import { afterEach, expect, it, vi } from "vitest";
import { googleNearbyPlaces } from "../lib/live-data";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("shares overlapping Places searches without retaining the results", async () => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-server-key");
  vi.stubEnv("GOOGLE_PLACES_ENABLED", "true");
  const calls: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    const grocery = !!body.includedPrimaryTypes;
    return Response.json({ places: [{ id: grocery ? "store-1" : "pump-1",
      displayName: { text: grocery ? "Publix" : "Shell" },
      formattedAddress: "Atlanta, GA", location: { latitude: 33.75, longitude: -84.388 } }] });
  }));

  const [all, groceries] = await Promise.all([
    googleNearbyPlaces("downtown", 5, "all"),
    googleNearbyPlaces("downtown", 5, "grocery"),
  ]);
  expect(calls).toHaveLength(2);
  expect(calls.find((body) => body.includedPrimaryTypes)).toMatchObject({
    rankPreference: "POPULARITY", maxResultCount: 20,
  });
  expect(all.places.map((place) => place.name)).toEqual(["Publix", "Shell"]);
  expect(groceries.places.map((place) => place.name)).toEqual(["Publix"]);

  await googleNearbyPlaces("downtown", 5, "grocery");
  expect(calls).toHaveLength(3);
});

it("checks additional grocery circles on demand and deduplicates their place IDs", async () => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-server-key");
  vi.stubEnv("GOOGLE_PLACES_ENABLED", "true");
  const centers: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const point = body.locationRestriction.circle.center;
    centers.push(`${point.latitude},${point.longitude}`);
    return Response.json({ places: [{ id: "store-1", displayName: { text: "Publix" },
      formattedAddress: "Atlanta, GA", location: { latitude: 33.75, longitude: -84.388 } }] });
  }));
  const result = await googleNearbyPlaces("downtown", 5, "grocery", undefined, true);
  expect(centers).toHaveLength(5);
  expect(new Set(centers).size).toBe(5);
  expect(result.places.map((place) => place.id)).toEqual(["store-1"]);
});

it("keeps the nearby stores when one optional expanded circle fails", async () => {
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "test-server-key");
  vi.stubEnv("GOOGLE_PLACES_ENABLED", "true");
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    calls += 1;
    if (calls === 2) return new Response("Unavailable", { status: 503 });
    return Response.json({ places: [{ id: "store-1", displayName: { text: "Publix" },
      formattedAddress: "Atlanta, GA", location: { latitude: 33.75, longitude: -84.388 } }] });
  }));
  const result = await googleNearbyPlaces("downtown", 5, "grocery", undefined, true);
  expect(calls).toBe(5);
  expect(result.places.map((place) => place.id)).toEqual(["store-1"]);
});
