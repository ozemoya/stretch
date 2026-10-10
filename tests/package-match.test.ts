import { expect, it } from "vitest";
import { packageMatches, prioritizePackageMatches } from "../lib/package-match";
import { needsBroaderCatalogSearch } from "../lib/provider-prices";

it("recognizes equivalent grocery package sizes", () => {
  expect(packageMatches("1 gallon", "128 fl oz")).toBe(true);
  expect(packageMatches("12 count", "1 dozen")).toBe(true);
  expect(packageMatches("2 lb", "32 oz")).toBe(true);
  expect(packageMatches("1 gallon", "64 fl oz")).toBe(false);
  expect(packageMatches("1 loaf", "20 oz")).toBe(false);
});

it("places matching packages first and requests another search when only other sizes were found", () => {
  const half = {
    id: "half",
    name: "Whole Milk",
    brand: "A",
    size: "64 fl oz",
    priceCents: 299,
    sourceUrl: "https://example.com/half",
    retrievedAt: "2026-10-10T00:00:00Z",
  };
  const gallon = {
    ...half,
    id: "gallon",
    size: "128 fl oz",
    sourceUrl: "https://example.com/gallon",
  };
  const item = { id: "milk", name: "Milk", unit: "1 gallon", quantity: 1 };
  expect(needsBroaderCatalogSearch([half], item)).toBe(true);
  expect(needsBroaderCatalogSearch([half, gallon], item)).toBe(false);
  expect(prioritizePackageMatches([half, gallon], item.unit)[0].id).toBe(
    "gallon",
  );
});
