import { expect, it } from "vitest";
import {
  freshMarketObservedReport,
  parseFreshMarketSpecials,
  parseFreshMarketBranchOffers,
} from "../lib/fresh-market-specials";
import type { NearbyPlace } from "../lib/live-data";
const place: NearbyPlace = {
  id: "store",
  name: "The Fresh Market",
  kind: "grocery",
  address: "2099 Peachtree Road Atlanta",
  lat: 33.812,
  lon: -84.3914,
  miles: 4.4,
  mapUrl: "",
};
const item = { id: "apple", name: "Apples", unit: "1 lb", quantity: 1 };
function html(
  price = "$2.49 lb",
  endDate = "2026-10-13T23:00:00Z",
  lat = 33.8121,
) {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { weeklySpecialsContent: { 0: { startDate: "2026-10-07T00:00:00Z", endDate, applicableStoresCollection: { items: [null, { storeNumber: 61, address: "2099 Peachtree Rd NW", city: "Atlanta", isClosed: false, storeLocation: { lat, lon: -84.3916 } }] }, specialItemsCollection: { items: [null, { sys: { id: "apple" }, specialItemName: "Envy Apples", specialMarketingPrice: price, product: { description: "" } }] } } } } } })}</script>`;
}
it("matches the nearby branch and keeps a per-pound rate explicit despite malformed neighboring entries", () => {
  const result = parseFreshMarketSpecials(
    html(),
    [place],
    [item],
    new Date("2026-10-09T12:00:00Z"),
  );
  expect(result.status).toBe("retrieved");
  expect(result.lines[0].products[0]).toMatchObject({
    priceCents: 249,
    size: "per lb · offer ends 2026-10-13",
    sourceUrl:
      "https://www.thefreshmarket.com/features/weekly-features?storeNumber=61",
  });
});
it("rejects expired offers, different branches and ambiguous promotions", () => {
  const now = new Date("2026-10-09T12:00:00Z");
  expect(
    parseFreshMarketSpecials(
      html("$2.49 lb", "2026-10-08T12:00:00Z"),
      [place],
      [item],
      now,
    ).status,
  ).toBe("failed");
  expect(
    parseFreshMarketSpecials(
      html("$2.49 lb", undefined, 40),
      [place],
      [item],
      now,
    ).status,
  ).toBe("failed");
  for (const price of [
    "Buy 1, Get 1 Free",
    "2/$5",
    "Starting at $2.49 ea",
    "30% Off",
  ])
    expect(
      parseFreshMarketSpecials(html(price), [place], [item], now).lines[0]
        .products,
    ).toEqual([]);
});
it("shows a dated in-store milk observation only for its nearby branch", () => {
  const milk = { id: "milk", name: "Milk", unit: "1 gal", quantity: 1 };
  const now = new Date("2026-10-10T05:00:00Z");
  const report = freshMarketObservedReport([place], [milk], now);
  expect(report.status).toBe("retrieved");
  expect(report.lines[0].products).toMatchObject([
    { priceCents: 1149, size: "1 gal" },
    { priceCents: 399, size: "0.5 gal", matchKind: "alternative" },
  ]);
  expect(
    freshMarketObservedReport(
      [{ ...place, address: "3000 Peachtree Road" }],
      [milk],
      now,
    ).lines[0].products,
  ).toEqual([]);
  expect(
    freshMarketObservedReport([place], [milk], new Date("2026-10-11T05:00:00Z"))
      .lines[0].products,
  ).toEqual([]);
});
it("binds an advertised offer and retailer image to the exact nearby branch", () => {
  const image = "https://thefreshmarket.widen.net/content/apples/jpeg/apples.jpeg?w=640";
  const source = html().replace('"specialItemName":"Envy Apples"',
    `"overwriteImageUrl":"${image}","specialItemName":"Envy Apples"`);
  const stores = parseFreshMarketBranchOffers(source, [place], [item], new Date("2026-10-09T12:00:00Z"));
  expect(stores).toHaveLength(1);
  expect(stores[0].lines[0].candidates[0]).toMatchObject({
    retailerId: "The Fresh Market", storeLocationId: "store", sourceStoreId: "61",
    productName: "Envy Apples", regularCents: 249, size: "1 lb", soldBy: "WEIGHT",
    imageUrl: image, priceKind: "branch_advertised",
  });
  expect(parseFreshMarketBranchOffers(source, [{ ...place, id: "other", address: "3000 Peachtree Road" }], [item], new Date("2026-10-09T12:00:00Z"))).toEqual([]);
});
it("rejects missing prices and unapproved image hosts for branch offers", () => {
  const source = html("Buy 1, Get 1 Free").replace('"specialItemName":"Envy Apples"',
    '"overwriteImageUrl":"https://example.com/apple.jpg","specialItemName":"Envy Apples"');
  expect(parseFreshMarketBranchOffers(source, [place], [item], new Date("2026-10-09T12:00:00Z"))).toEqual([]);
});
