import { describe, it, expect, vi } from "vitest";
import {
  catalogSearchOptions,
  runCatalog,
} from "../scripts/kroger-catalog.mjs";

describe("Kroger catalog batch", () => {
  it("uses measurable catalog sizes and only real Kroger category labels", () => {
    expect(
      catalogSearchOptions({
        id: "eggs",
        name: "Eggs",
        unit: "12 count",
        category: "Staples",
      }),
    ).toMatchObject({ item: "Eggs", amount: { unit: "each", amount: 12 } });
    expect(
      catalogSearchOptions({
        id: "eggs",
        name: "Eggs",
        unit: "12 count",
        category: "Staples",
      }),
    ).toHaveProperty("category", "Dairy");
    expect(
      catalogSearchOptions({
        id: "apples",
        name: "Apples",
        unit: "3 lb",
        category: "Produce",
      }),
    ).toMatchObject({
      category: "Produce",
      amount: { unit: "oz", amount: 48 },
    });
    expect(
      catalogSearchOptions({ id: "bread", name: "Bread", unit: "1 loaf" }),
    ).not.toHaveProperty("amount");
    expect(
      catalogSearchOptions({ id: "bread", name: "Bread", unit: "1 loaf" }).unit,
    ).toBe("oz");
    expect(
      catalogSearchOptions({ id: "cheddar", name: "Cheddar", unit: "8 oz" })
        .category,
    ).toBe("Dairy");
    expect(
      catalogSearchOptions({
        id: "chickpeas",
        name: "Chickpeas",
        unit: "15 oz",
      }).item,
    ).toBe("garbanzo beans");
    expect(
      catalogSearchOptions({
        id: "olive-oil",
        name: "Olive oil",
        unit: "16.9 oz",
      }).amount,
    ).toEqual({ unit: "fl-oz", amount: 16.9 });
  });
  it("attempts every ID once, preserves failures and checkpoints successful saves", async () => {
    const catalog = [
      { id: "eggs", name: "Eggs", unit: "12 count" },
      { id: "milk", name: "Milk", unit: "1 gallon" },
      { id: "rice", name: "Rice", unit: "2 lb" },
    ];
    const makeClient = () => ({
      from: () => ({
        select: () => ({
          order: () => ({
            range: async () => ({ data: catalog, error: null }),
          }),
        }),
      }),
    });
    const runSearch = vi.fn(async (options) => {
      if (options.item === "Milk") throw new Error("Unavailable");
      return {
        rows: [],
        products: [{ source: "database" }],
        complete: true,
        issues: [],
      };
    });
    const checkpoint = vi.fn();
    const result = await runCatalog(
      {
        origin: { latitude: 33.75, longitude: -84.39 },
        glutenFree: true,
        vegan: true,
        nutFree: true,
      },
      {
        env: {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SECRET_KEY: "test",
        },
        makeClient,
        runSearch,
        checkpoint,
        log: () => {},
        fetcher: vi.fn(),
        now: () => new Date("2026-10-10T12:00:00Z"),
      },
    );
    expect(runSearch).toHaveBeenCalledTimes(3);
    expect(
      runSearch.mock.calls.every(
        ([options]) => options.glutenFree && options.vegan && options.nutFree,
      ),
    ).toBe(true);
    expect(result.results.map((row) => row.catalog_id)).toEqual([
      "eggs",
      "milk",
      "rice",
    ]);
    expect(result).toMatchObject({ completed: 2, partial: 0, failed: 1 });
    expect(checkpoint).toHaveBeenCalledTimes(4);
    expect(result.results[1].error).toBe("Unavailable");
  });
});
