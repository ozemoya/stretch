import { afterEach, expect, it, vi } from "vitest";
import { getRouteMeasurements } from "../lib/routing";
import sample from "../lib/sample-catalog.json";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

it("routes through the selected station before returning to the starting point", async () => {
  const calls: { lat: number; lon: number }[][] = [];
  globalThis.fetch = vi.fn(async (_url, init) => {
    const points = JSON.parse(String(init?.body)).points;
    calls.push(points);
    return Response.json({ miles: 11.5, minutes: 24 });
  }) as typeof fetch;
  const station = {
    id: "fuel-1",
    name: "Example fuel stop",
    address: "Atlanta",
    lat: 33.755,
    lon: -84.39,
    mapUrl: "https://www.openstreetmap.org/node/1",
  };
  const origin = { lat: 33.75, lon: -84.38 };
  const routes = await getRouteMeasurements(
    sample,
    "downtown",
    station,
    origin,
  );
  expect(Object.keys(routes).length).toBeGreaterThan(0);
  expect(calls.some((points) => points.length === 4)).toBe(true);
  expect(calls.some((points) => points.length === 5)).toBe(true);
  for (const points of calls) {
    expect(points[0]).toEqual(origin);
    expect(points.at(-2)).toEqual({ lat: station.lat, lon: station.lon });
    expect(points.at(-1)).toEqual(origin);
  }
});
