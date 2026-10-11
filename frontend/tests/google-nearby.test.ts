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
