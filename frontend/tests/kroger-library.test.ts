import { afterEach, describe, expect, it, vi } from "vitest";
import type { createClient } from "@supabase/supabase-js";

// Next.js supplies this marker internally; no extra package is needed.
vi.mock("server-only", () => ({}));
import {
  findCheapestKrogerProducts,
  saveCheapestKrogerProducts,
  normalizeSearchOptions,
  productRow,
  productDate,
  type KrogerProductRow,
  type KrogerSearchOptions,
} from "../lib/kroger";

const origin = { latitude: 33.75, longitude: -84.39 };
const env = {
  KROGER_CLIENT_ID: "test-client",
  KROGER_CLIENT_SECRET: "test-secret",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "test-db-key",
};
const stores = ["01100672", "01100695", "01100461"].map((locationId, i) => ({
  locationId,
  name: `Kroger - Branch ${i}`,
  geolocation: { latitude: 33.75 + i / 100, longitude: -84.39 },
  address: {
    addressLine1: `${i} Main St`,
    city: "Atlanta",
    state: "GA",
    zipCode: "30303",
  },
}));
function fixture({
  failStore = false,
  limited = false,
  existing = [],
  lookupError = false,
  dietary = false,
}: {
  failStore?: boolean;
  limited?: boolean;
  existing?: KrogerProductRow[];
  lookupError?: boolean;
  dietary?: boolean;
} = {}) {
  const write = vi.fn((table: string, rows: unknown[]) => ({
    select: async () => ({ data: rows, error: null }),
  }));
  const makeClient = vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        limit: async () => ({ error: null }),
        in: async (_column: string, ids: number[]) => ({
          data: existing.filter((row) => ids.includes(row.ID)),
          error: lookupError ? { message: "denied" } : null,
        }),
      }),
      upsert: (rows: unknown[]) => write(table, rows),
    }),
  }));
  const fetcher = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/token"))
      return Response.json({ access_token: "test-token", expires_in: 3600 });
    if (url.pathname.endsWith("/locations"))
      return Response.json({ data: stores });
    if (url.pathname.endsWith("/products")) {
      if (failStore && url.searchParams.get("filter.locationId") === "01100695")
        return new Response("unavailable", { status: 503 });
      const term = url.searchParams.get("filter.term");
      const baseTerm = term?.replace(
        /\s+(?:gluten free|vegan|nut free)\b/g,
        "",
      );
      const eggs = term?.startsWith("eggs");
      const milk = term === "whole milk";
      const start = Number(url.searchParams.get("filter.start"));
      const product = (id: number, size: string, price: number) => ({
        productId: String(id),
        description: `Kroger ${baseTerm}${dietary ? " Gluten Free Vegan Nut Free" : ""}`,
        categories: [eggs || milk ? "Dairy" : "Canned & Packaged"],
        items: [
          {
            itemId: String(id),
            soldBy: "UNIT",
            size,
            price: { regular: price },
          },
        ],
      });
      return Response.json({
        data: limited
          ? Array.from({ length: 50 }, (_, i) => product(start + i, "12 ct", 2))
          : eggs
            ? [
                product(1, "12 ct", 2),
                { ...product(2, "16 ct", 1), description: "Kroger eggs" },
                product(3, "12 ct", 3),
              ]
            : [product(1, milk ? "1 gal" : "15.5 oz", milk ? 2.79 : 1)],
        ...(limited ? { meta: { pagination: { total: 400 } } } : {}),
      });
    }
    throw new Error(`Unexpected provider ${url.hostname}`);
  });
  return {
    fetcher,
    makeClient: makeClient as unknown as typeof createClient,
    write,
    env,
    now: () => new Date("2026-10-10T12:00:00Z"),
  };
}

afterEach(() => vi.restoreAllMocks());

describe("shared Kroger library", () => {
  it("geocodes an address-only Kroger branch before ranking and saving it", async () => {
    const h = fixture();
    const original = h.fetcher;
    h.fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "geocoding.geo.census.gov") return Response.json({ result: { addressMatches: [{
        coordinates: { x: -84.39, y: 33.75 }, addressComponents: { zip: "30303" },
      }] } });
      if (url.pathname.endsWith("/locations")) return Response.json({ data: stores.map((store, index) =>
        index === 0 ? { ...store, geolocation: undefined } : store) });
      return original(input, init);
    });
    const result = await saveCheapestKrogerProducts({ item: "whole milk", amount: "1 gal", origin }, h);
    expect(result.products).toHaveLength(3);
    expect(result.products.find(row => row.location_key === "kroger:branch:1100672")?.store)
      .toMatchObject({ latitude: 33.75, longitude: -84.39 });
  });

  it("saves and reuses dietary winners separately from regular searches", async () => {
    const options = {
      item: "black beans",
      amount: "16 oz",
      origin,
      glutenFree: true,
      vegan: true,
      nutFree: true,
    };
    const plain = await saveCheapestKrogerProducts(
      { item: "black beans", amount: "16 oz", origin },
      fixture(),
    );
    const h = fixture({ dietary: true, existing: plain.products });
    const result = await saveCheapestKrogerProducts(options, h);
    expect(result.products).toHaveLength(3);
    expect(
      result.products.every(
        (row) => row.gluten_free && row.vegan && row.nut_free,
      ),
    ).toBe(true);
    expect(result.products.map((row) => row.ID)).not.toEqual(
      plain.products.map((row) => row.ID),
    );
    expect(
      h.fetcher.mock.calls.some(([input]) =>
        String(input).includes(
          "filter.term=black+beans+gluten+free+vegan+nut+free",
        ),
      ),
    ).toBe(true);
    const cached = fixture({ existing: result.products });
    const reused = await saveCheapestKrogerProducts(options, cached);
    expect(reused.products.every((row) => row.source === "database")).toBe(
      true,
    );
    expect(
      cached.fetcher.mock.calls.some(([input]) =>
        new URL(String(input)).pathname.endsWith("/products"),
      ),
    ).toBe(false);
    expect(cached.write).not.toHaveBeenCalled();
  });

  it("rejects unknown claims and repairs cached rows that no longer satisfy filters", async () => {
    const options = {
      item: "black beans",
      amount: "16 oz",
      origin,
      glutenFree: true,
    };
    const unknown = fixture();
    const empty = await saveCheapestKrogerProducts(options, unknown);
    expect(empty.products).toHaveLength(0);
    expect(unknown.write).not.toHaveBeenCalled();
    const good = await saveCheapestKrogerProducts(
      options,
      fixture({ dietary: true }),
    );
    const h = fixture({
      dietary: true,
      existing: good.products.map((row) => ({ ...row, gluten_free: null })),
    });
    const repaired = await saveCheapestKrogerProducts(options, h);
    expect(
      repaired.products.every(
        (row) => row.source === "kroger" && row.gluten_free === true,
      ),
    ).toBe(true);
  });
  it("imports without fetching, logging, loading env files or changing process exit status", async () => {
    vi.resetModules();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const log = vi.spyOn(console, "log");
    const exitCode = process.exitCode;
    const envBefore = { ...process.env };
    await import("../lib/kroger");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(exitCode);
    expect(process.env).toEqual(envBefore);
  });

  it("checks saved records and finds exact-size winners without database writes", async () => {
    const h = fixture();
    const log = vi.fn();
    const result = await findCheapestKrogerProducts(
      { item: " eggs ", amount: 12, category: "Dairy", origin },
      { ...h, log },
    );
    expect(result.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(3);
    expect(
      result.rows.every(
        (row) => row.product_id === "1" && row.package_count === 12,
      ),
    ).toBe(true);
    expect(h.makeClient).toHaveBeenCalledOnce();
    expect(h.write).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain("[4/5]");
    expect(
      h.fetcher.mock.calls.every(([url]) =>
        String(url).includes("api.kroger.com"),
      ),
    ).toBe(true);
  });

  it.each([
    [{ item: "eggs", amount: 12, category: "Dairy" }, 12, 12],
    [{ item: "whole milk", amount: "1 gal", category: "Dairy" }, 1, 128],
    [
      { item: "black beans", unit: "oz", category: "Canned & Packaged" },
      1,
      15.5,
    ],
  ] as [KrogerSearchOptions, number, number][])(
    "saves %j with physical count %s and comparison quantity %s",
    async (options, count, quantity) => {
      const h = fixture();
      const log = vi.spyOn(console, "log");
      const result = await saveCheapestKrogerProducts(
        { ...options, origin },
        h,
      );
      expect(result.complete).toBe(true);
      expect(h.write.mock.calls.map(([table]) => table)).toEqual([
        "store",
        "product",
      ]);
      const saved = h.write.mock.calls[1][1] as KrogerProductRow[];
      expect(saved).toHaveLength(3);
      for (const row of saved) {
        expect(row.count).toBe(count);
        expect(row.unit_price).toBeCloseTo(row.price / quantity, 10);
      }
      expect(result.rows.map(productRow)).toEqual(saved);
      expect(saved.every((row) => row.date === "2026-10-10")).toBe(true);
      expect(log).not.toHaveBeenCalled();
    },
  );

  it("returns structured failures alongside available winners", async () => {
    const result = await findCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      fixture({ failStore: true }),
    );
    expect(result.complete).toBe(false);
    expect(result.rows).toHaveLength(2);
    expect(result.issues).toEqual([
      {
        kind: "store-search-failed",
        locationId: "01100695",
        message: "Kroger products: HTTP 503.",
      },
    ]);
  });

  it("exposes pagination limits to callers even when all three stores have winners", async () => {
    const result = await findCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      fixture({ limited: true }),
    );
    expect(result.rows).toHaveLength(3);
    expect(result.complete).toBe(false);
    expect(result.issues.map((issue) => issue.kind)).toEqual(
      Array(3).fill("search-limited"),
    );
  });

  it("skips every product search and write when the same requested amount is already saved", async () => {
    const initial = await saveCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      fixture(),
    );
    const h = fixture({ existing: initial.products });
    const log = vi.fn();
    const result = await saveCheapestKrogerProducts(
      { item: " EGGS ", amount: "1 dozen", origin },
      { ...h, log },
    );
    expect(result.complete).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.products).toHaveLength(3);
    expect(
      result.products.every(
        (row) => row.source === "database" && row.count === 12,
      ),
    ).toBe(true);
    expect(
      h.fetcher.mock.calls.some(([url]) =>
        new URL(String(url)).pathname.endsWith("/products"),
      ),
    ).toBe(false);
    expect(h.write).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain(
      "Kroger product search skipped",
    );
  });

  it("searches and saves only the missing store and keeps results in nearest-store order", async () => {
    const initial = await saveCheapestKrogerProducts(
      { item: "whole milk", amount: "1 gal", origin },
      fixture(),
    );
    const h = fixture({ existing: initial.products.slice(0, 2) });
    const result = await saveCheapestKrogerProducts(
      { item: "whole milk", amount: { unit: "fl-oz", amount: 128 }, origin },
      h,
    );
    expect(result.complete).toBe(true);
    expect(result.products.map((row) => row.source)).toEqual([
      "database",
      "database",
      "kroger",
    ]);
    expect(result.products.map((row) => row.locationID)).toEqual([
      1100672, 1100695, 1100461,
    ]);
    const searches = h.fetcher.mock.calls.filter(([url]) =>
      new URL(String(url)).pathname.endsWith("/products"),
    );
    expect(searches).toHaveLength(1);
    expect(
      new URL(String(searches[0][0])).searchParams.get("filter.locationId"),
    ).toBe("01100461");
    expect(h.write.mock.calls[1][1]).toHaveLength(1);
  });

  it("refreshes today's rows only under an explicit correction override", async () => {
    const options = { item: "eggs", amount: 12, origin };
    const initial = await saveCheapestKrogerProducts(options, fixture());
    const h = fixture({ existing: initial.products });
    const result = await saveCheapestKrogerProducts(
      { ...options, forceRefresh: true },
      h,
    );
    expect(result.products.every((row) => row.source === "kroger")).toBe(true);
    expect(result.products.map((row) => row.ID)).toEqual(
      initial.products.map((row) => row.ID),
    );
    expect(h.write.mock.calls[1][1]).toHaveLength(3);
  });

  it("does not treat a different requested amount as a database hit", async () => {
    const initial = await saveCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      fixture(),
    );
    const h = fixture({ existing: initial.products });
    const result = await findCheapestKrogerProducts(
      { item: "eggs", amount: 24, origin },
      h,
    );
    expect(
      result.products.every(
        (row) => row.source === "kroger" && row.count === 16,
      ),
    ).toBe(true);
    expect(
      h.fetcher.mock.calls.filter(([url]) =>
        new URL(String(url)).pathname.endsWith("/products"),
      ),
    ).toHaveLength(3);
  });

  it("uses a read key for previews and returns saved rows without products API calls", async () => {
    const initial = await saveCheapestKrogerProducts(
      { item: "black beans", unit: "oz", origin },
      fixture(),
    );
    const h = fixture({ existing: initial.products });
    const result = await findCheapestKrogerProducts(
      { item: "black beans", unit: "oz", origin },
      {
        ...h,
        env: {
          KROGER_CLIENT_ID: "a",
          KROGER_CLIENT_SECRET: "b",
          NEXT_PUBLIC_SUPABASE_URL: env.SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "read-key",
        },
      },
    );
    expect(result.products).toHaveLength(3);
    expect(h.makeClient).toHaveBeenCalledWith(
      env.SUPABASE_URL,
      "read-key",
      expect.any(Object),
    );
    expect(h.write).not.toHaveBeenCalled();
    expect(
      h.fetcher.mock.calls.some(([url]) =>
        new URL(String(url)).pathname.endsWith("/products"),
      ),
    ).toBe(false);
  });

  it("stops product searches when the database lookup fails", async () => {
    const h = fixture({ lookupError: true });
    await expect(
      saveCheapestKrogerProducts({ item: "eggs", amount: 12, origin }, h),
    ).rejects.toThrow("Could not check saved products");
    expect(
      h.fetcher.mock.calls.some(([url]) =>
        new URL(String(url)).pathname.endsWith("/products"),
      ),
    ).toBe(false);
    expect(h.write).not.toHaveBeenCalled();
  });

  it("refreshes yesterday's row under its original ID and only searches that store", async () => {
    const initial = await saveCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      fixture(),
    );
    const existing = initial.products.map((row, i) =>
      i === 1
        ? { ...row, date: "2026-10-09", price: 1, unit_price: 1 / 12 }
        : row,
    );
    const h = fixture({ existing });
    const result = await saveCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      h,
    );
    expect(result.products.map((row) => row.source)).toEqual([
      "database",
      "kroger",
      "database",
    ]);
    expect(result.products[1]).toMatchObject({
      ID: initial.products[1].ID,
      price: 2,
      count: 12,
      date: "2026-10-10",
    });
    expect(
      h.fetcher.mock.calls.filter(([url]) =>
        new URL(String(url)).pathname.endsWith("/products"),
      ),
    ).toHaveLength(1);
    expect(h.write.mock.calls[1][1]).toHaveLength(1);
    expect(existing[1].date).toBe("2026-10-09");
  });

  it.each(["2026-10-08", null])(
    "refreshes old or undated records (%s)",
    async (date) => {
      const initial = await saveCheapestKrogerProducts(
        { item: "whole milk", amount: "1 gal", origin },
        fixture(),
      );
      const h = fixture({
        existing: initial.products.map((row) => ({ ...row, date })),
      });
      const result = await saveCheapestKrogerProducts(
        { item: "whole milk", amount: "1 gal", origin },
        h,
      );
      expect(
        result.products.every(
          (row) => row.source === "kroger" && row.date === "2026-10-10",
        ),
      ).toBe(true);
      expect(h.write.mock.calls[1][1]).toHaveLength(3);
    },
  );

  it("reuses today's records until Eastern midnight and refreshes them immediately after", async () => {
    const initial = await saveCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      fixture(),
    );
    const before = fixture({ existing: initial.products });
    const cached = await saveCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      {
        ...before,
        now: () => new Date("2026-10-11T03:59:59Z"),
      },
    );
    expect(cached.products.every((row) => row.source === "database")).toBe(
      true,
    );
    expect(before.write).not.toHaveBeenCalled();
    const after = fixture({ existing: initial.products });
    const refreshed = await saveCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      {
        ...after,
        now: () => new Date("2026-10-11T04:00:00Z"),
      },
    );
    expect(
      refreshed.products.every(
        (row) => row.source === "kroger" && row.date === "2026-10-11",
      ),
    ).toBe(true);
    expect(refreshed.products.map((row) => row.ID)).toEqual(
      initial.products.map((row) => row.ID),
    );
  });

  it("keeps stale rows untouched when a refresh fails", async () => {
    const initial = await saveCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      fixture(),
    );
    const existing = initial.products.map((row, i) =>
      i === 1 ? { ...row, date: "2026-10-09" } : row,
    );
    const h = fixture({ existing, failStore: true });
    const result = await saveCheapestKrogerProducts(
      { item: "eggs", amount: 12, origin },
      h,
    );
    expect(result.complete).toBe(false);
    expect(result.products).toHaveLength(2);
    expect(result.issues[0].kind).toBe("store-search-failed");
    expect(h.write).not.toHaveBeenCalled();
    expect(existing[1].date).toBe("2026-10-09");
  });

  it("formats Eastern dates across daylight saving boundaries and rejects invalid timestamps", () => {
    expect(productDate("2026-11-02T04:59:59Z")).toBe("2026-11-01");
    expect(productDate("2026-11-02T05:00:00Z")).toBe("2026-11-02");
    expect(() => productDate("invalid")).toThrow("retrieval date");
  });

  it("normalizes equivalent amounts and rejects invalid object inputs before any I/O", async () => {
    expect(
      normalizeSearchOptions({ item: "milk", amount: "1 gal" }).amount,
    ).toEqual({ unit: "fl-oz", amount: 128 });
    expect(
      normalizeSearchOptions({
        item: "milk",
        amount: { unit: "fl-oz", amount: 128 },
      }).amount,
    ).toEqual({ unit: "fl-oz", amount: 128 });
    const h = fixture();
    for (const options of [
      { item: "" },
      { item: "eggs", amount: NaN },
      { item: "eggs", amount: { unit: "each", amount: -12 } },
      { item: "eggs", origin: { latitude: 91, longitude: 0 } },
      { item: "eggs", origin, zip: "30303" },
    ] as KrogerSearchOptions[]) {
      await expect(saveCheapestKrogerProducts(options, h)).rejects.toThrow();
    }
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.makeClient).not.toHaveBeenCalled();
  });
});
