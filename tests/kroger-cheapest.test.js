import { describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  readOptions,
  nearestStores,
  cheapestPackage,
  matchesItem,
  chooseCategory,
  matchesCategory,
  productCategories,
  resolveOrigin,
  productRow,
  storeRow,
  splitStoreName,
  parsePackageSize,
  parsePackageCount,
  searchProducts,
  run,
} from "../scripts/kroger-cheapest.mjs";

const product = (id, price, extra = {}) => ({
  productId: id,
  description: `Milk ${id}`,
  categories: ["Dairy"],
  items: [
    {
      itemId: id,
      soldBy: "UNIT",
      size: "1 gallon",
      price: { regular: price },
      ...extra,
    },
  ],
});
const store = (id, latitude) => ({
  locationId: id,
  name: `Kroger ${id}`,
  address: { city: "Atlanta" },
  geolocation: { latitude, longitude: -84.39 },
});
const origin = { latitude: 33.75, longitude: -84.39 };
const env = {
  KROGER_CLIENT_ID: "test-client",
  KROGER_CLIENT_SECRET: "test-secret",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "test-db-key",
};

describe("Kroger cheapest CLI", () => {
  it("parses requested amounts and rejects missing or incompatible dimensions", () => {
    expect(readOptions(["--item", "eggs", "--amount", "12"]).amount).toEqual({
      unit: "each",
      amount: 12,
    });
    expect(readOptions(["--item", "milk", "--amount", "1 gal"]).amount).toEqual(
      { unit: "fl-oz", amount: 128 },
    );
    expect(readOptions(["--item", "rice", "--amount", "16 oz"]).amount).toEqual(
      { unit: "oz", amount: 16 },
    );
    expect(() => readOptions(["--item", "rice", "--amount", "12"])).toThrow(
      "Specify --unit",
    );
    for (const amount of ["0", "-12", "large", ""]) {
      expect(() => readOptions(["--item", "eggs", "--amount", amount])).toThrow(
        "--amount",
      );
    }
    expect(() =>
      readOptions(["--item", "eggs", "--amount", "16 oz", "--unit", "each"]),
    ).toThrow("same measurement dimension");
  });

  const egg = (id, quantity, price, extra = {}) => ({
    ...product(id, price, { size: `${quantity} ct`, ...extra }),
    description: "Large White Eggs",
  });
  const preferredEggs = (products) =>
    cheapestPackage(products, "eggs", undefined, undefined, "Dairy", {
      unit: "each",
      amount: 12,
    });

  it("prefers the lowest unit price among eligible exact sizes", () => {
    expect(
      preferredEggs([
        egg("cheap-sixteen", 16, 0.5),
        egg("expensive-dozen", 12, 3),
        egg("cheap-dozen", 12, 2),
        egg("bulk", 60, 0.1),
      ]),
    ).toMatchObject({ product_id: "cheap-dozen", package_quantity: 12 });
  });

  it("falls back to inclusive 8–16 sizes and ranks by unit price", () => {
    expect(
      preferredEggs([
        egg("unavailable-exact", 12, 0.1, {
          inventory: { stockLevel: "TEMPORARILY_OUT_OF_STOCK" },
        }),
        egg("lower-bound", 8, 1.2),
        egg("upper-bound", 16, 2),
        egg("too-small", 7, 0.01),
        egg("too-large", 17, 0.01),
      ]),
    ).toMatchObject({ product_id: "upper-bound", unit_price_cents: 200 / 16 });
    expect(preferredEggs([egg("lower-bound", 8, 1.2)])?.product_id).toBe(
      "lower-bound",
    );
    expect(
      preferredEggs([egg("small", 7, 0.1), egg("bulk", 60, 0.1)]),
    ).toBeNull();
  });

  it("recognizes equivalent exact measurements and filters incompatible sizes", () => {
    const amount = readOptions(["--item", "milk", "--amount", "1 gal"]).amount;
    expect(
      cheapestPackage(
        [
          product("nearby-cheaper", 1, { size: "96 fl oz" }),
          product("exact", 3, { size: "128 fl oz" }),
          product("weight", 0.01, { size: "128 oz" }),
        ],
        "milk",
        undefined,
        undefined,
        "Dairy",
        amount,
      )?.product_id,
    ).toBe("exact");
    const metric = { unit: "fl-oz", amount: parsePackageSize("1 l").amount };
    expect(
      cheapestPackage(
        [product("metric", 2, { size: "1000 ml" })],
        "milk",
        undefined,
        undefined,
        "Dairy",
        metric,
      )?.product_id,
    ).toBe("metric");
  });

  it("stops at Kroger's supported offset and labels a limited search", async () => {
    const get = vi.fn(async (path, filters) => ({
      data: Array.from({ length: 50 }, (_, i) =>
        product(String(Number(filters["filter.start"]) + i), 3),
      ),
      meta: { pagination: { total: 1000 } },
    }));
    const log = vi.fn();
    const products = await searchProducts(get, "store", "eggs", log);
    expect(products).toHaveLength(300);
    expect(products.searchLimited).toBe(true);
    expect(get).toHaveBeenCalledTimes(6);
    expect(get.mock.calls.at(-1)[1]["filter.start"]).toBe("250");
    expect(log.mock.calls.flat().join("\n")).toContain("SEARCH LIMITED");
  });

  it("compares eggs by count, including count/total-weight labels", () => {
    const eggs = [
      {
        ...product("dozen", 1.79, { size: "12 ct" }),
        description: "Large White Eggs",
      },
      {
        ...product("sixty", 8.75, { size: "60 ct" }),
        description: "Large White Eggs",
      },
      {
        ...product("mixed-label", 3.99, { size: "12 ct / 24 oz" }),
        description: "Large Brown Eggs",
      },
      {
        ...product("weight", 0.1, { size: "3.1 oz" }),
        description: "Cooked Eggs",
      },
    ];
    expect(parsePackageSize("12 ct / 24 oz", "each")).toEqual({
      unit: "each",
      amount: 12,
    });
    expect(cheapestPackage(eggs, "eggs")).toMatchObject({
      product_id: "sixty",
      comparison_unit: "each",
      package_quantity: 60,
      package_count: 60,
      unit_price_cents: 875 / 60,
    });
  });
  it("uses provider categories and excludes products with missing or wrong labels", () => {
    const milk = product("milk", 3);
    const candy = { ...product("candy", 0.01), categories: ["Candy"] };
    const unlabeled = {
      ...product("missing-category", 0.01),
      categories: undefined,
    };
    expect(
      cheapestPackage(
        [milk, candy, unlabeled],
        "milk",
        undefined,
        undefined,
        "Dairy",
      ),
    ).toMatchObject({
      product_id: "milk",
      matched_category: "Dairy",
      provider_categories: ["Dairy"],
    });
    expect(cheapestPackage([unlabeled], "milk")).toBeNull();
    expect(matchesCategory(candy, "Dairy")).toBe(false);
    expect(matchesCategory(milk, "dairy")).toBe(true);
    expect(
      productCategories({
        categories: ["Dairy", " dairy ", null, "", "Natural & Organic"],
      }),
    ).toEqual(["dairy", "Natural & Organic"]);
  });

  it("does not let duplicate or merchandising labels decide a category", () => {
    expect(
      chooseCategory(
        [
          { ...product("a", 3), categories: ["Dairy", "Natural & Organic"] },
          { ...product("b", 3), categories: ["Dairy", "Natural & Organic"] },
          { ...product("c", 1), categories: ["Candy", "Candy", "Candy"] },
        ],
        "milk",
      ),
    ).toBe("Dairy");
    expect(() =>
      chooseCategory(
        [product("a", 3), { ...product("b", 1), categories: ["Candy"] }],
        "milk",
      ),
    ).toThrow("ambiguous");
    expect(chooseCategory([product("a", 3)], "milk", "Candy")).toBe("Candy");
    expect(
      cheapestPackage([product("a", 3)], "milk", undefined, undefined, "Candy"),
    ).toBeNull();
  });
  it("validates arguments and preserves ZIP leading zeros", () => {
    expect(
      readOptions(["--zip", "01234", "--item", "  whole   milk ", "--dry-run"]),
    ).toEqual({ zip: "01234", item: "whole milk", dryRun: true });
    expect(() => readOptions(["--zip", "123", "--item", "milk"])).toThrow(
      "five-digit",
    );
    expect(() => readOptions(["--zip", "30303"])).toThrow("--item");
    expect(() => readOptions(["--unknown"])).toThrow();
  });
  it("sorts by actual distance, deduplicates and takes the nearest three", () => {
    expect(
      nearestStores(
        {
          data: [
            store("far", 34),
            store("01100695", 33.78),
            store("01100672", 33.76),
            store("01100461", 33.8),
            store("01100672", 33.76),
          ],
        },
        origin,
        100,
      ).map((s) => s.locationId),
    ).toEqual(["01100672", "01100695", "01100461"]);
    expect(() =>
      nearestStores(
        {
          data: [store("01100672", 33.76)],
          meta: { pagination: { total: 201 } },
        },
        origin,
        100,
      ),
    ).toThrow("incomplete");
    expect(() =>
      nearestStores(
        { data: [{ locationId: "a", name: "Kroger" }] },
        origin,
        100,
      ),
    ).toThrow("coordinates");
  });
  it("compares package variants and ignores unusable or weighted prices", () => {
    const products = [
      product("promo", 5, { price: { regular: 5, promo: 0.1 } }),
      product("weight", 0.5, { soldBy: "WEIGHT" }),
      product("unknown", 0),
      product("missing", 0, { price: undefined }),
      product("out", 0.1, {
        inventory: { stockLevel: "TEMPORARILY_OUT_OF_STOCK" },
      }),
      product("best", 2.99, { price: { regular: 2.99, promo: 2.49 } }),
    ];
    products[0].items.push({
      itemId: "small",
      soldBy: "UNIT",
      size: "8 fl oz",
      price: { regular: 1.25 },
    });
    expect(cheapestPackage(products, "milk")).toMatchObject({
      product_id: "best",
      item_id: "best",
      regular_price_cents: 299,
      package_size: "1 gallon",
      unit_price_cents: 299 / 128,
      package_quantity: 128,
      package_count: 1,
      comparison_unit: "fl-oz",
      price_basis: "unit",
    });
    expect(cheapestPackage([products.at(-1)], "milk")).toMatchObject({
      regular_price_cents: 299,
      promo_price_cents: 249,
    });
    expect(cheapestPackage([product("x", -1)], "milk")).toBeNull();
  });
  it("includes a cheapest result from a later page", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        data: Array.from({ length: 50 }, (_, i) => product(String(i), 5)),
        meta: { pagination: { total: 51 } },
      })
      .mockResolvedValueOnce({
        data: [product("cheap", 1)],
        meta: { pagination: { total: 51 } },
      });
    const result = await searchProducts(get, "store", "milk", () => {});
    expect(cheapestPackage(result, "milk").product_id).toBe("cheap");
    expect(get.mock.calls[1][1]["filter.start"]).toBe("50");
  });

  it("normalizes volume, weight, counts, fractions and explicit multipacks", () => {
    for (const [size, amount] of [
      ["1 gallon", 128],
      ["1/2 gal", 64],
      ["half gallon", 64],
      ["½ gal", 64],
      ["1 1/2 qt", 48],
      ["1 pt", 16],
      ["16 fl. oz.", 16],
      ["6 ct / 8 fl oz", 48],
      ["6 x 8 fl oz", 48],
      ["12 pack 8 fl oz", 96],
    ])
      expect(parsePackageSize(size), size).toEqual({ unit: "fl-oz", amount });
    expect(parsePackageSize("1 l").amount).toBeCloseTo(33.8140227);
    expect(parsePackageSize("1000 ml")).toEqual(parsePackageSize("1 l"));
    expect(parsePackageSize("1 lb")).toEqual({ unit: "oz", amount: 16 });
    expect(parsePackageSize("1 kg")).toEqual(parsePackageSize("1000 g"));
    expect(parsePackageSize("12 ct")).toEqual({ unit: "each", amount: 12 });
    expect(parsePackageSize("1 dozen")).toEqual({ unit: "each", amount: 12 });
    for (const size of [
      undefined,
      "",
      "large",
      "0 oz",
      "1/0 gal",
      "6/8 fl oz",
      "8-12 oz",
      "2 pk",
      "16 fl oz / 473 ml",
    ])
      expect(parsePackageSize(size), String(size)).toBeNull();
  });

  it("chooses a gallon over a cheaper carton and uses the entire multipack", () => {
    const products = [
      product("carton", 1.5, { size: "8 fl oz" }),
      product("gallon", 3.49),
      product("pack", 4, { size: "6 ct / 32 fl oz" }),
    ];
    expect(cheapestPackage(products.slice(0, 2), "milk").product_id).toBe(
      "gallon",
    );
    expect(cheapestPackage(products, "milk")).toMatchObject({
      product_id: "pack",
      package_quantity: 192,
      package_count: 6,
      unit_price_cents: 400 / 192,
    });
  });

  it("counts individual items separately from their normalized size", () => {
    for (const [label, unit, count] of [
      ["12 ct", "each", 12],
      ["1 dozen", "each", 12],
      ["12 ct / 24 oz", "each", 12],
      ["12 ct / 24 oz", "oz", 12],
      ["1 gal", "fl-oz", 1],
      ["1/2 gal", "fl-oz", 1],
      ["15.5 oz", "oz", 1],
      ["1 lb", "oz", 1],
      ["6 ct / 8 fl oz", "fl-oz", 6],
      ["6 CT. / 8 FL. OZ.", "fl-oz", 6],
      ["6 x 8 fl oz", "fl-oz", 6],
      ["2 x 12 ct", "each", 24],
      ["2 x 1 gal", "fl-oz", 2],
    ])
      expect(parsePackageCount(label, unit), label).toBe(count);
    expect(parsePackageCount("1.5 ct", "each")).toBeNull();
    expect(parsePackageCount("6/8 fl oz", "fl-oz")).toBeNull();
    const beans = cheapestPackage(
      [
        {
          ...product("beans", 1, { size: "15.5 oz" }),
          description: "Black Beans",
          categories: ["Canned & Packaged"],
        },
      ],
      "black beans",
      "oz",
    );
    expect(beans).toMatchObject({
      package_count: 1,
      package_quantity: 15.5,
      unit_price_cents: 100 / 15.5,
    });
  });

  it("does not round rates before ranking and breaks exact ties by package price", () => {
    const products = [
      product("small", 1, { size: "32 fl oz" }),
      product("large", 3.99, { size: "128 fl oz" }),
    ];
    expect(cheapestPackage(products, "milk").product_id).toBe("large");
    products[1].items[0].price.regular = 4;
    expect(cheapestPackage(products, "milk").product_id).toBe("small");
  });

  it("skips unknown sizes and refuses to compare incompatible dimensions", () => {
    expect(
      cheapestPackage([product("unknown", 0.01, { size: "large" })], "milk"),
    ).toBeNull();
    expect(
      cheapestPackage([product("weight", 0.01, { size: "16 oz" })], "milk"),
    ).toBeNull();
    const products = [
      product("mass", 1, { size: "16 oz" }),
      product("count", 0.1, { size: "1 ct" }),
    ].map((p) => ({ ...p, description: "Rice" }));
    expect(() => cheapestPackage(products, "rice")).toThrow(
      "mix volume, weight, or count",
    );
    expect(cheapestPackage(products, "rice", "oz").product_id).toBe("mass");
    expect(
      readOptions(["--zip", "30303", "--item", "rice", "--unit", "oz"]).unit,
    ).toBe("oz");
    expect(() =>
      readOptions(["--zip", "30303", "--item", "rice", "--unit", "bad"]),
    ).toThrow("--unit");
  });
  it("rejects stalled pagination rather than saving a false minimum", async () => {
    const get = vi.fn().mockResolvedValue({
      data: [product("same", 2)],
      meta: { pagination: { total: 10 } },
    });
    await expect(
      searchProducts(get, "store", "milk", () => {}),
    ).rejects.toThrow("stopped progressing");
  });

  it("rejects the live yogurt regression before comparing prices", () => {
    const milk = {
      ...product("milk", 1.5),
      description: "Horizon Organic Shelf Stable Whole Milk",
    };
    const yogurt = {
      ...product("yogurt", 0.5),
      description: "Chobani Whole Milk Blended Greek Honey Yogurt",
    };
    expect(cheapestPackage([yogurt, milk], "whole milk").product_id).toBe(
      "milk",
    );
    expect(cheapestPackage([yogurt], "whole milk")).toBeNull();
    expect(cheapestPackage([yogurt], "whole milk yogurt").product_id).toBe(
      "yogurt",
    );
  });

  it("requires whole query words and excludes unrequested milk products", () => {
    for (const description of [
      "Chobani Whole Milk Greek Yogurt",
      "Whole Milk Mozzarella Cheese",
      "Whole Milk Ice Cream",
      "Whole Milk Powder",
      "Sweetened Condensed Whole Milk",
      "Whole Milk Chocolate",
      "Whole Milk Infant Formula",
      "Whole Milk Pudding",
      "Whole Oat Milk",
      "Whole Goat Milk",
      "Whole Buttermilk",
      "Kroger Skim Milk",
    ])
      expect(matchesItem({ description }, "whole milk"), description).toBe(
        false,
      );
    expect(
      matchesItem({ description: "Kroger WHOLE-MILK Vitamin D" }, "whole milk"),
    ).toBe(true);
    expect(
      matchesItem(
        { description: "Whole Milk Chocolate" },
        "chocolate whole milk",
      ),
    ).toBe(true);
    expect(
      matchesItem({ description: "Unsweetened Almond Milk" }, "almond milk"),
    ).toBe(true);
    expect(matchesItem({ description: "Brown Rice" }, "white rice")).toBe(
      false,
    );
    expect(matchesItem({ description: "Whole Milk" }, "")).toBe(false);
  });

  function harness({
    failStore,
    emptyStore,
    dbError,
    storeError,
    fewStores = false,
  } = {}) {
    const upsert = vi.fn((rows) => ({
      select: async () => ({
        data: rows,
        error: dbError,
      }),
    }));
    const storeUpsert = vi.fn((rows) => ({
      select: async () => ({ data: rows, error: storeError }),
    }));
    const makeClient = vi.fn(() => ({
      from: (table) => ({
        select: () => ({
          limit: async () => ({ error: null }),
          in: async () => ({ data: [], error: null }),
        }),
        upsert: table === "store" ? storeUpsert : upsert,
      }),
    }));
    const fetcher = vi.fn(async (url) => {
      const parsed = new URL(url);
      let data;
      if (parsed.hostname === "api.zippopotam.us") data = { places: [origin] };
      else if (parsed.hostname === "ipapi.co")
        data = { ...origin, city: "Atlanta", region: "Georgia" };
      else if (parsed.pathname.endsWith("/token"))
        data = { access_token: "secret-token", expires_in: 3600 };
      else if (parsed.pathname.endsWith("/locations"))
        data = {
          data: fewStores
            ? [store("01100672", 33.76)]
            : [
                store("01100461", 33.8),
                store("01100695", 33.78),
                store("01100672", 33.76),
              ],
        };
      else {
        const id = parsed.searchParams.get("filter.locationId");
        if (id === failStore) return new Response("error", { status: 429 });
        data = {
          data:
            id === emptyStore
              ? []
              : [
                  product(`${id}-expensive`, 5),
                  product(`${id}-cheap`, 2),
                  {
                    ...product(`${id}-yogurt`, 0.5),
                    description:
                      "Chobani Whole Milk Blended Greek Honey Yogurt",
                  },
                ],
        };
      }
      return Response.json(data);
    });
    const log = vi.fn();
    return { upsert, storeUpsert, makeClient, fetcher, log, env };
  }
  const options = { zip: "30303", item: "milk", dryRun: false };
  it("applies the requested package range before saving", async () => {
    const h = harness();
    const result = await run(
      { ...options, amount: { unit: "fl-oz", amount: 64 } },
      h,
    );
    expect(result.rows).toHaveLength(0);
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it("upserts exactly one cheapest product row per item and store", async () => {
    const h = harness();
    const result = await run(options, h);
    expect(result.complete).toBe(true);
    expect(h.upsert).toHaveBeenCalledOnce();
    expect(h.storeUpsert).toHaveBeenCalledOnce();
    expect(h.storeUpsert.mock.calls[0][0][0]).toMatchObject({
      latitude: 33.76,
      longitude: -84.39,
      address: "Atlanta",
    });
    expect(h.storeUpsert.mock.invocationCallOrder[0]).toBeLessThan(
      h.upsert.mock.invocationCallOrder[0],
    );
    expect(
      h.upsert.mock.calls[0][0].every(
        (row) => !("store" in row) && !("sub-location" in row),
      ),
    ).toBe(true);
    expect(result.rows.map((r) => r.product_id)).toEqual([
      "01100672-cheap",
      "01100695-cheap",
      "01100461-cheap",
    ]);
    expect(result.rows.every((row) => row.matched_category === "Dairy")).toBe(
      true,
    );
    expect(result.rows[0]).toMatchObject({
      price_basis: "unit",
      comparison_unit: "fl-oz",
      package_quantity: 128,
      package_count: 1,
      unit_price_cents: 200 / 128,
    });
    expect(h.log.mock.calls.flat().join("\n")).toContain(
      "Saved 3 product rows",
    );
    expect(h.log.mock.calls.flat().join("\n")).not.toContain("secret-token");
  });
  it("supports a dry run without database credentials or writes", async () => {
    const h = harness();
    await run(
      { ...options, dryRun: true },
      { ...h, env: { KROGER_CLIENT_ID: "a", KROGER_CLIENT_SECRET: "b" } },
    );
    expect(h.makeClient).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.storeUpsert).not.toHaveBeenCalled();
  });
  it("does not save products if the store save fails", async () => {
    const h = harness({ storeError: { message: "denied" } });
    await expect(run(options, h)).rejects.toThrow("store save");
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it("saves successful stores and clearly reports failures and empty matches", async () => {
    const h = harness({ failStore: "01100695", emptyStore: "01100461" });
    const result = await run(options, h);
    expect(result.complete).toBe(false);
    expect(result.rows).toHaveLength(1);
    expect(h.log.mock.calls.flat().join("\n")).toContain("HTTP 429");
  });
  it("expands the radius and reports fewer than three nearby stores", async () => {
    const h = harness({ fewStores: true });
    expect((await run(options, h)).complete).toBe(false);
    expect(
      h.fetcher.mock.calls.filter(([url]) =>
        String(url).includes("/locations?"),
      ),
    ).toHaveLength(4);
  });
  it("reports database failures instead of claiming a successful save", async () => {
    await expect(
      run(options, harness({ dbError: { message: "denied" } })),
    ).rejects.toThrow("did not confirm");
  });
  it("fails before network calls when credentials are missing", async () => {
    const h = harness();
    await expect(run(options, { ...h, env: {} })).rejects.toThrow("Missing");
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});

describe("current location and existing product mapping", () => {
  it("splits Kroger brand from branch without duplicating the brand", () => {
    expect(splitStoreName("Kroger - Ponce")).toEqual({
      store: "Kroger",
      "sub-location": "Ponce",
    });
    expect(splitStoreName("Kroger - Glenwood Kroger")).toEqual({
      store: "Kroger",
      "sub-location": "Glenwood",
    });
    expect(splitStoreName("Kroger Glenwood")).toEqual({
      store: "Kroger",
      "sub-location": "Glenwood",
    });
    expect(splitStoreName("Kroger — Edgewood")).toEqual({
      store: "Kroger",
      "sub-location": "Edgewood",
    });
    expect(splitStoreName("Kroger")).toEqual({
      store: "Kroger",
      "sub-location": null,
    });
  });
  it("falls back to a second IP provider after a rate limit", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("limited", { status: 429 }))
      .mockResolvedValueOnce(
        Response.json({ success: true, latitude: 33.75, longitude: -84.39 }),
      );
    expect(await resolveOrigin({}, fetcher, () => {})).toEqual({
      latitude: 33.75,
      longitude: -84.39,
    });
    expect(fetcher.mock.calls[1][0]).toBe("https://ipwho.is/");
  });
  it("defaults to IP location without a ZIP and validates coordinate overrides", async () => {
    expect(readOptions(["--item", "whole milk"])).toEqual({
      item: "whole milk",
      dryRun: false,
    });
    const fetcher = vi.fn(async () =>
      Response.json({ latitude: 33.75, longitude: -84.39, city: "Atlanta" }),
    );
    expect(await resolveOrigin({}, fetcher, () => {})).toEqual({
      latitude: 33.75,
      longitude: -84.39,
    });
    expect(fetcher.mock.calls[0][0]).toBe("https://ipapi.co/json/");
    const options = readOptions(["--item", "milk", "--lat", "0", "--lng", "0"]);
    expect(await resolveOrigin(options, fetcher, () => {})).toEqual({
      latitude: 0,
      longitude: 0,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(() => readOptions(["--item", "milk", "--lat", "33"])).toThrow(
      "both",
    );
    expect(() =>
      readOptions(["--item", "milk", "--lat", "91", "--lng", "0"]),
    ).toThrow("invalid");
    await expect(
      resolveOrigin(
        {},
        async () => Response.json({ error: true }),
        () => {},
      ),
    ).rejects.toThrow("IP location lookup failed");
  });

  const result = {
    search_term: "whole milk",
    location_id: "01100672",
    store_name: "Kroger Glenwood",
    regular_price_cents: 279,
    unit_price_cents: 279 / 128,
    package_quantity: 128,
    package_count: 1,
  };
  it("maps package unit count to product and keeps IDs stable across winner changes", () => {
    const row = productRow(result);
    expect(row).toMatchObject({
      category: "whole milk",
      count: 1,
      price: 2.79,
      unit_price: 2.79 / 128,
      locationID: 1100672,
    });
    expect(row).not.toHaveProperty("store");
    expect(row).not.toHaveProperty("sub-location");
    expect(storeRow(result)).toEqual({
      locationID: 1100672,
      store: "Kroger",
      "sub-location": "Glenwood",
      latitude: null,
      longitude: null,
      address: null,
    });
    expect(Number.isSafeInteger(row.ID)).toBe(true);
    expect(
      productRow({
        ...result,
        search_term: " WHOLE  MILK ",
        regular_price_cents: 399,
      }).ID,
    ).toBe(row.ID);
    expect(productRow({ ...result, location_id: "01100695" }).ID).not.toBe(
      row.ID,
    );
    expect(productRow({ ...result, search_term: "skim milk" }).ID).not.toBe(
      row.ID,
    );
    expect(() => productRow({ ...result, location_id: "bad" })).toThrow(
      "location ID",
    );
  });

  it("saves physical item counts and rejects fractional item counts", () => {
    expect(productRow({ ...result, package_count: 12 }).count).toBe(12);
    expect(
      productRow({ ...result, package_quantity: 15.5, package_count: 1 }).count,
    ).toBe(1);
    for (const package_count of [
      undefined,
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() => productRow({ ...result, package_count })).toThrow(
        "product.count",
      );
    }
  });

  it("maps provider coordinates and formats a full street address", () => {
    const row = storeRow({
      ...result,
      store_geolocation: { latitude: 33.742558, longitude: -84.35962 },
      store_address: {
        addressLine1: " 800 Glenwood Ave SE ",
        addressLine2: " Suite 1 ",
        city: "Atlanta",
        state: "GA",
        zipCode: "30316",
      },
    });
    expect(row).toMatchObject({
      latitude: 33.742558,
      longitude: -84.35962,
      address: "800 Glenwood Ave SE, Suite 1, Atlanta, GA 30316",
    });
    expect(
      storeRow({
        ...result,
        store_geolocation: { latitude: 0, longitude: 0 },
        store_address: {},
      }),
    ).toMatchObject({ latitude: 0, longitude: 0, address: null });
    expect(() =>
      storeRow({
        ...result,
        store_geolocation: { latitude: 91, longitude: 0 },
      }),
    ).toThrow("invalid coordinates");
    expect(() =>
      storeRow({ ...result, store_geolocation: { latitude: 33 } }),
    ).toThrow("omitted location coordinates");
  });

  it("keeps different searched counts separate and repeated searches stable", () => {
    const eggs = { ...result, search_term: "eggs", comparison_unit: "each" };
    const dozen = productRow({
      ...eggs,
      requested_amount: { unit: "each", amount: 12 },
      package_quantity: 12,
      package_count: 12,
    });
    const thirty = productRow({
      ...eggs,
      requested_amount: { unit: "each", amount: 30 },
      package_quantity: 30,
      package_count: 30,
    });
    expect(dozen.ID).not.toBe(thirty.ID);
    expect(dozen.ID).not.toBe(productRow(eggs).ID);
    const fallback = productRow({
      ...eggs,
      requested_amount: { unit: "each", amount: 12 },
      package_quantity: 16,
      package_count: 16,
      regular_price_cents: 199,
    });
    expect(fallback.ID).toBe(dozen.ID);
    expect(fallback.count).toBe(16);
    expect(
      productRow({ ...eggs, requested_amount: { unit: "oz", amount: 12 } }).ID,
    ).not.toBe(dozen.ID);
  });

  it("gives equivalent searched amounts the same identifier", () => {
    const gallon = readOptions(["--item", "milk", "--amount", "1 gal"]).amount;
    const ounces = readOptions([
      "--item",
      "milk",
      "--amount",
      "128 fl oz",
    ]).amount;
    expect(productRow({ ...result, requested_amount: gallon }).ID).toBe(
      productRow({ ...result, requested_amount: ounces }).ID,
    );
    const liter = readOptions(["--item", "milk", "--amount", "1 l"]).amount;
    const milliliters = readOptions([
      "--item",
      "milk",
      "--amount",
      "1000 ml",
    ]).amount;
    expect(productRow({ ...result, requested_amount: liter }).ID).toBe(
      productRow({ ...result, requested_amount: milliliters }).ID,
    );
  });

  it("preserves other searched counts when a winner is replaced", async () => {
    const db = new PGlite();
    try {
      await db.exec(
        'create table product ("ID" numeric primary key, category text, count integer, price numeric)',
      );
      const eggs = { ...result, search_term: "eggs" };
      const dozen = {
        ...eggs,
        requested_amount: { unit: "each", amount: 12 },
        package_quantity: 12,
        package_count: 12,
      };
      const thirty = {
        ...eggs,
        requested_amount: { unit: "each", amount: 30 },
        package_quantity: 30,
        package_count: 30,
      };
      const sql =
        'insert into product ("ID",category,count,price) values ($1,$2,$3,$4) on conflict ("ID") do update set count=excluded.count,price=excluded.price';
      for (const winner of [
        dozen,
        thirty,
        {
          ...dozen,
          package_quantity: 16,
          package_count: 16,
          regular_price_cents: 199,
        },
      ]) {
        const row = productRow(winner);
        await db.query(sql, [row.ID, row.category, row.count, row.price]);
      }
      const rows = (await db.query("select * from product order by count"))
        .rows;
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.count)).toEqual([16, 30]);
      expect(Number(rows[0].price)).toBe(1.99);
      expect(Number(rows[1].price)).toBe(2.79);
    } finally {
      await db.close();
    }
  }, 20000);

  it("updates the existing product schema without appending every variety", async () => {
    const db = new PGlite();
    try {
      await db.exec(
        'create table store ("locationID" numeric primary key, store text, "sub-location" text); create table product (category text not null, count integer, price numeric not null, unit_price numeric, "locationID" numeric references store("locationID"), "ID" numeric primary key)',
      );
      const row = productRow(result);
      const branch = storeRow(result);
      await db.query("insert into store values ($1,$2,$3)", [
        branch.locationID,
        branch.store,
        branch["sub-location"],
      ]);
      const sql =
        'insert into product ("ID", category, count, price, unit_price, "locationID") values ($1,$2,$3,$4,$5,$6) on conflict ("ID") do update set count=excluded.count,price=excluded.price,unit_price=excluded.unit_price';
      await db.query(sql, [
        row.ID,
        row.category,
        row.count,
        row.price,
        row.unit_price,
        row.locationID,
      ]);
      await db.query(sql, [
        row.ID,
        row.category,
        1,
        2.99,
        2.99 / 64,
        row.locationID,
      ]);
      const rows = (
        await db.query(
          'select product.*, store.store, store."sub-location" from product join store using ("locationID")',
        )
      ).rows;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].price)).toBe(2.99);
      expect(Number(rows[0].unit_price)).toBeCloseTo(2.99 / 64);
      expect(rows[0].count).toBe(1);
      expect(rows[0].store).toBe("Kroger");
      expect(rows[0]["sub-location"]).toBe("Glenwood");
    } finally {
      await db.close();
    }
  }, 20000);
});
