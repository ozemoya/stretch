import { describe, expect, it } from "vitest";
import {
  parseEia,
  normalizePlaces,
  normalizeKrogerProducts,
} from "../lib/live-data";
const publication = `<table><caption>U.S. Regular Gasoline Prices*(dollars per gallon)</caption><thead><tr><th></th><th>09/21/26</th><th>09/28/26</th><th>10/05/26</th><th>year ago</th></tr></thead><tbody><tr><td>Lower Atlantic (PADD1C)</td><td>4.163</td><td>4.195</td><td>3.959</td><td>1.062</td></tr></tbody></table><table><caption>Diesel</caption><tbody><tr><td>Lower Atlantic</td><td>8</td></tr></tbody></table>`;
describe("live data normalization", () => {
  it("filters requested place kind before limiting results and excludes out-of-radius centers", () => {
    const grocery = Array.from({ length: 65 }, (_, id) => ({
      type: "node",
      id,
      lat: 33.749,
      lon: -84.388,
      tags: { shop: "supermarket", name: "Grocery" },
    }));
    const data = {
      osm3s: { timestamp_osm_base: "2026-10-09" },
      elements: [
        ...grocery,
        {
          type: "way",
          id: 66,
          center: { lat: 33.75, lon: -84.388 },
          tags: { amenity: "fuel", name: "Local gas" },
        },
        {
          type: "node",
          id: 67,
          lat: 34,
          lon: -84.388,
          tags: { amenity: "fuel", name: "Far gas" },
        },
      ],
    };
    const result = normalizePlaces(data, "downtown", 1, "fuel");
    expect(result.places.map((p) => p.name)).toEqual(["Local gas"]);
    expect(result.radiusMiles).toBe(1);
  });
  it("selects latest regular fuel price rather than changes or diesel", () => {
    expect(
      parseEia(publication, new Date("2026-10-09T12:00:00Z")),
    ).toMatchObject({ dollarsPerGallon: 3.959, period: "2026-10-05" });
  });
  it("rejects missing, stale and future prices instead of presenting them as current", () => {
    expect(() => parseEia("<table></table>")).toThrow();
    expect(() => parseEia(publication, new Date("2026-11-09"))).toThrow(
      /out of date/,
    );
    expect(() => parseEia(publication, new Date("2026-09-01"))).toThrow(
      /out of date/,
    );
  });
  it("supports mapped nodes and ways, labels distance and does not invent prices", () => {
    const p = normalizePlaces(
      {
        osm3s: { timestamp_osm_base: "2026-10-09" },
        elements: [
          {
            type: "node",
            id: 1,
            lat: 33.749,
            lon: -84.388,
            tags: { name: "Aldi", shop: "supermarket" },
          },
          {
            type: "way",
            id: 2,
            center: { lat: 33.75, lon: -84.389 },
            tags: { brand: "Shell", amenity: "fuel" },
          },
        ],
      },
      "downtown",
    );
    expect(p.places).toHaveLength(2);
    expect(p.places[0].miles).toBe(0);
    expect(p.places[1].kind).toBe("fuel");
    expect(p.places[0]).not.toHaveProperty("price");
  });
  it("keeps package variants, unknown prices and promotional prices distinct", () => {
    const p = normalizeKrogerProducts(
      {
        data: [
          {
            productId: "1",
            description: "Milk",
            upc: "123",
            items: [
              {
                itemId: "a",
                size: "1 gallon",
                price: { regular: 3.99, promo: 2.99 },
              },
              { itemId: "b", size: "half gallon" },
              { itemId: "c", price: { regular: 0, promo: 0 } },
            ],
          },
        ],
      },
      "01100123",
    );
    expect(p).toHaveLength(3);
    expect(p[0]).toMatchObject({
      regularCents: 399,
      promoCents: 299,
      size: "1 gallon",
      locationId: "01100123",
    });
    expect(p[1].regularCents).toBeNull();
    expect(p[2].regularCents).toBeNull();
  });
});
