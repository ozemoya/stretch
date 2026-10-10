import { describe, expect, it } from "vitest";
import {
  cheapestPackage,
  dietaryFlags,
  matchesDietary,
  normalizeSearchOptions,
  productID,
  productRow,
} from "../lib/kroger/core.mjs";
import { readOptions } from "../scripts/kroger-cheapest.mjs";
import { catalogSearchOptions } from "../scripts/kroger-catalog.mjs";

const bread = (id, description, price, size = "16 oz") => ({
  productId: id,
  description,
  categories: ["Bakery"],
  items: [{ itemId: id, soldBy: "UNIT", size, price: { regular: price } }],
});
describe("Kroger dietary criteria", () => {
  it("records explicit claims and preserves unknowns without inferring from substitutes", () => {
    expect(
      dietaryFlags({ description: "Gluten-Free VEGAN Nut-Free Bread" }),
    ).toEqual({ gluten_free: true, vegan: true, nut_free: true });
    for (const description of [
      "Organic bread",
      "Vegetarian dairy-free plant-based bread",
      "Peanut-free bread",
      "Tree nut free bread",
      "Gluten friendly bread",
    ])
      expect(dietaryFlags({ description })).toEqual({
        gluten_free: null,
        vegan: null,
        nut_free: null,
      });
    expect(
      dietaryFlags({
        description: "Not gluten-free non-vegan not nut free bread",
      }),
    ).toEqual({ gluten_free: false, vegan: false, nut_free: false });
    expect(
      dietaryFlags({ description: "Gluten free bread, not gluten free" })
        .gluten_free,
    ).toBe(false);
    expect(dietaryFlags({ description: "Not a vegan bread" }).vegan).toBe(
      false,
    );
    expect(
      dietaryFlags({ description: "Not certified gluten free bread" })
        .gluten_free,
    ).toBe(false);
    expect(
      matchesDietary(
        { gluten_free: true, vegan: null, nut_free: null },
        { glutenFree: true, vegan: true },
      ),
    ).toBe(false);
  });
  it("filters before exact-size preference and lowest unit price ranking", () => {
    const products = [
      bread("cheap", "Bread", 1),
      bread("partial", "Gluten free bread", 2),
      bread("high", "Gluten free vegan bread", 5),
      bread("low", "Gluten free vegan bread", 4),
      bread("fallback", "Gluten free vegan bread", 1, "20 oz"),
    ];
    const best = cheapestPackage(
      products,
      "bread",
      "oz",
      () => {},
      "Bakery",
      { unit: "oz", amount: 16 },
      { glutenFree: true, vegan: true },
    );
    expect(best.product_id).toBe("low");
    expect(best).toMatchObject({
      gluten_free: true,
      vegan: true,
      nut_free: null,
    });
    expect(
      cheapestPackage(products, "bread", "oz", () => {}, "Bakery", undefined, {
        nutFree: true,
      }),
    ).toBeNull();
  });
  it("normalizes flags, parses CLI options and forwards catalog criteria", () => {
    expect(
      readOptions([
        "--item",
        "bread",
        "--gluten-free",
        "--vegan",
        "--nut-free",
      ]),
    ).toMatchObject({ glutenFree: true, vegan: true, nutFree: true });
    expect(
      normalizeSearchOptions({ item: "bread", glutenFree: false }),
    ).not.toHaveProperty("glutenFree");
    for (const flag of ["glutenFree", "vegan", "nutFree"])
      expect(() =>
        normalizeSearchOptions({ item: "bread", [flag]: "true" }),
      ).toThrow("boolean");
    expect(
      catalogSearchOptions(
        { id: "bread", name: "Bread", unit: "1 loaf", vegan: true },
        { glutenFree: true },
      ),
    ).toMatchObject({ glutenFree: true });
    expect(
      catalogSearchOptions({
        id: "bread",
        name: "Bread",
        unit: "1 loaf",
        vegan: true,
      }),
    ).not.toHaveProperty("vegan");
  });
  it("retains old IDs and isolates every dietary combination without flag-order dependence", () => {
    const plain = productID("bread", "01100672");
    expect(productID("bread", "01100672", undefined, { vegan: false })).toBe(
      plain,
    );
    const ids = new Set();
    for (let bits = 0; bits < 8; bits++)
      ids.add(
        productID("bread", "01100672", undefined, {
          glutenFree: !!(bits & 1),
          vegan: !!(bits & 2),
          nutFree: !!(bits & 4),
        }),
      );
    expect(ids.size).toBe(8);
    expect(
      productID("bread", "01100672", undefined, {
        vegan: true,
        glutenFree: true,
      }),
    ).toBe(
      productID("bread", "01100672", undefined, {
        glutenFree: true,
        vegan: true,
      }),
    );
    const mapped = productRow({
      search_term: "bread",
      location_id: "01100672",
      package_count: 1,
      regular_price_cents: 400,
      unit_price_cents: 25,
      requested_dietary: { glutenFree: true },
      gluten_free: true,
    });
    expect(mapped).toMatchObject({
      gluten_free: true,
      vegan: null,
      nut_free: null,
    });
    expect(mapped.ID).not.toBe(plain);
  });
});
