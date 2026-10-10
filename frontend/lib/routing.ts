
import type { Catalog, Preferences } from "./types";
import type {
  RouteMeasurements,
} from "./optimizer";
import {
  sampleStoreLocations,
  sampleStartingLocations,
  type Coordinates,
} from "./storeLocations";

type RouteResponse = {
  miles: number;
  minutes: number;
};

async function requestRoute(
  points: Coordinates[],
): Promise<RouteResponse> {
  const response = await fetch("/api/routes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ points }),
  });

  if (!response.ok) {
    throw new Error(
      `Routing failed: ${response.status}`,
    );
  }

  const result: RouteResponse = await response.json();

  if (
    !Number.isFinite(result.miles) ||
    result.miles < 0 ||
    !Number.isFinite(result.minutes) ||
    result.minutes < 0
  ) {
    throw new Error("Invalid route response");
  }

  return result;
}

export async function getRouteMeasurements(
  catalog: Catalog,
  area: Preferences["area"],
): Promise<RouteMeasurements> {
  const home = sampleStartingLocations[area];

  if (!home) {
    throw new Error("Unknown starting area");
  }

  const routes: RouteMeasurements = {};
  const stores = catalog.stores;

  // One-store round trips
  for (const store of stores) {
    const location = sampleStoreLocations[store.id];
    if (!location) continue;

    const key = store.id;

    try {
      routes[key] = await requestRoute([
        home,
        location,
        home,
      ]);
    } catch (error) {
      console.warn(`Route failed: ${key}`, error);
    }
  }

  // Two-store trips, including both visit orders
  for (let i = 0; i < stores.length; i++) {
    for (let j = i + 1; j < stores.length; j++) {
      const first = stores[i];
      const second = stores[j];

      const firstLocation =
        sampleStoreLocations[first.id];
      const secondLocation =
        sampleStoreLocations[second.id];

      if (!firstLocation || !secondLocation) {
        continue;
      }

      const orders = [
        {
          key: `${first.id}|${second.id}`,
          points: [
            home,
            firstLocation,
            secondLocation,
            home,
          ],
        },
        {
          key: `${second.id}|${first.id}`,
          points: [
            home,
            secondLocation,
            firstLocation,
            home,
          ],
        },
      ];

      for (const route of orders) {
        try {
          routes[route.key] =
            await requestRoute(route.points);
        } catch (error) {
          console.warn(
            `Route failed: ${route.key}`,
            error,
          );
        }
      }
    }
  }

  return routes;
}
