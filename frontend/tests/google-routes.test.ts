import { afterEach, expect, it, vi } from "vitest";
import { decodeGooglePolyline, googleRoute, googleRouteMatrix } from "../lib/google-routes";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const points = [{ lat: 33.75, lon: -84.39 }, { lat: 33.76, lon: -84.38 }];

it("decodes Google geometry and route legs without exposing the API key", async () => {
  const fetchMock = vi.fn(async (_url, init) => {
    expect((init?.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("test-key");
    expect(String(init?.body)).not.toContain("test-key");
    return Response.json({ routes: [{ distanceMeters: 1609, duration: "420s",
      polyline: { encodedPolyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@" },
      legs: [{ distanceMeters: 1609, duration: "420s" }] }] });
  });
  globalThis.fetch = fetchMock as typeof fetch;
  const route = await googleRoute(points, "test-key", AbortSignal.timeout(1000));
  expect(route.provider).toBe("google");
  expect(route.minutes).toBe(7);
  expect(route.legs).toHaveLength(1);
  expect(route.geometry.coordinates).toHaveLength(3);
  expect(decodeGooglePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")[0]).toEqual([-120.2, 38.5]);
});

it("maps each matrix element by indices and leaves missing road legs unavailable", async () => {
  globalThis.fetch = vi.fn(async () => Response.json([
    { originIndex: 0, destinationIndex: 1, condition: "ROUTE_EXISTS", distanceMeters: 1609, duration: "300s" },
    { originIndex: 1, destinationIndex: 0, condition: "ROUTE_NOT_FOUND" },
  ])) as typeof fetch;
  const matrix = await googleRouteMatrix(points, "test-key", AbortSignal.timeout(1000));
  expect(matrix.distances[0][1]).toBe(1609);
  expect(matrix.durations[0][1]).toBe(300);
  expect(matrix.distances[1][0]).toBeNull();
});
