import { expect, it } from "vitest";
import { productRouteStop } from "../lib/product-route-stop";
import type { NearbyPlace } from "../lib/live-data";
const place = (id: string, name: string, miles: number): NearbyPlace => ({ id, name, miles,
  kind: "grocery", lat: 33.75, lon: -84.39, address: `${id} Main St`, mapUrl: "https://maps.google.com" });
it("routes catalog selections to the nearest matching retailer, never another chain", () => {
  const stores = [place("aldi", "ALDI", .1), place("far", "Trader Joe's", 4), place("near", "Trader Joe’s", 2)];
  expect(productRouteStop("Trader Joe’s", stores)?.id).toBe("near");
  expect(productRouteStop("Walmart", stores)).toBeNull();
});
it("excludes gas stations and invalid coordinates", () => {
  expect(productRouteStop("ALDI", [{ ...place("1", "ALDI", 1), kind: "fuel" },
    { ...place("2", "ALDI", 1), lat: NaN }])).toBeNull();
});
it("requires an exact name for independent retailers", () => {
  expect(productRouteStop("Local Market", [place("1", "Other Market", 1), place("2", "Local Market", 2)])?.id).toBe("2");
});
