import { expect, it } from "vitest";
import { parseLidlProducts, scrapeRetailers } from "../lib/retailer-scraper";
const time = "2026-10-09T12:00:00Z";
function tile(overrides = {}) {
  const value = {
    productId: 11237148,
    fullTitle: "organic reduced fat milk, 2%",
    canonicalPath: "/p/organic-reduced-fat-milk-2/p11237148",
    price: {
      currencyCode: "USD",
      price: 3.49,
      basePrice: { text: "$0.05 per fl oz" },
      packaging: { text: "64 fl. oz." },
    },
    ...overrides,
  };
  return `<div data-grid-data='${JSON.stringify(value)}'></div>`;
}
it("reads package price rather than the unit or category price and preserves provenance", () => {
  const results = parseLidlProducts(tile() + tile(), "milk", time);
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({
    priceCents: 349,
    size: "64 fl. oz.",
    retrievedAt: time,
    sourceUrl: "https://www.lidl.com/p/organic-reduced-fat-milk-2/p11237148",
  });
});
it("rejects unrelated products, unpriced packages, non-USD, unsafe links and variant ambiguity", () => {
  expect(parseLidlProducts(tile(), "eggs", time)).toEqual([]);
  for (const price of [
    { currencyCode: "EUR", price: 3, packaging: { text: "1 gal" } },
    { currencyCode: "USD", price: 0, packaging: { text: "1 gal" } },
    { currencyCode: "USD", price: 3 },
    {
      currencyCode: "USD",
      price: 3,
      packaging: { text: "1 gal" },
      variantsHaveDifferentPrices: true,
    },
  ])
    expect(parseLidlProducts(tile({ price }), "milk", time)).toEqual([]);
  expect(
    parseLidlProducts(
      tile({ canonicalPath: "https://malicious.test/p/milk" }),
      "milk",
      time,
    ),
  ).toEqual([]);
  expect(
    parseLidlProducts('<div data-grid-data="bad json"></div>', "milk", time),
  ).toEqual([]);
});
it.runIf(process.env.STRETCH_LIVE_SMOKE === "1")(
  "retrieves real public Lidl prices without credentials",
  async () => {
    const result = await scrapeRetailers(
      [
        {
          id: "proof",
          retailer: "Lidl",
          name: "Lidl",
          address: "",
          miles: 1,
          lat: 33.75,
          lon: -84.39,
          mapUrl: "",
          status: "unavailable",
          detail: "",
        },
      ],
      [
        { id: "eggs", name: "Eggs", quantity: 1, unit: "12 ct" },
        { id: "milk", name: "Milk", quantity: 1, unit: "1 gal" },
      ],
    );
    expect(result[0].status).toBe("retrieved");
    expect(result[0].lines.every((l) => l.products.length > 0)).toBe(true);
    console.log(
      JSON.stringify(
        result[0].lines.map((l) => ({
          item: l.item.name,
          product: l.products[0],
        })),
        null,
        2,
      ),
    );
  },
  45000,
);
