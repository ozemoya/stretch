import { expect, it } from "vitest";
import { parseFreshMarketSpecials } from "../lib/fresh-market-specials";
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
