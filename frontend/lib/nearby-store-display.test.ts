import { describe, expect, it } from "vitest";
import { nearbyGroceryStores } from "./nearby-store-display";
import type { NearbyPlace } from "./live-data";

const place = (id: string, name: string, kind: NearbyPlace["kind"]): NearbyPlace => ({
  id, name, kind, brand: "", address: `${id} Main Street`, lat: 33.75,
  lon: -84.39, miles: 1, mapUrl: `https://www.openstreetmap.org/node/${id}`,
});

describe("nearby grocery display", () => {
  it("shows every mapped grocery location even when none has a price source", () => {
    const places = [
      place("1", "Trader Joe's", "grocery"),
      place("2", "Kroger", "grocery"),
      place("3", "Publix", "grocery"),
      place("4", "BP", "fuel"),
    ];
    expect(nearbyGroceryStores(places).map((store) => store.name)).toEqual([
      "Trader Joe's", "Kroger", "Publix",
    ]);
    expect(nearbyGroceryStores([...places, places[1]], "Kroger")).toHaveLength(1);
  });
});
