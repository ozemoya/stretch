import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { parsePublixSavings } from "../lib/scrapers/publix";
import { normalizeCatalogReport } from "../lib/product-ownership";
import { scraperRegistry } from "../lib/scrapers";

vi.mock("../lib/provider-prices", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/provider-prices")>()),
  providerSupports: vi.fn(() => false),
  providerReports: vi.fn(),
}));

const at = "2026-10-10T12:00:00Z";
// Fields captured from the anonymous /api/v4/savings response for store 1825 on October 10, 2026.
const offer = {
  waId: -2023386384,
  savings: "$4.99",
  title: "Pete &amp; Gerry&#39;s Organic Brown Eggs",
  description: "Large, Free Range, Grade A, 12-ct. ctn.",
  brand: "Pete and Gerry&#39;s",
  savingType: "WeeklyAd",
  minimumPurchase: 0,
  isSneakPeek: false,
  wa_startDate: "2026-10-07T00:00:00Z",
  wa_endDate: "2026-10-20T23:59:59Z",
  wa_postStartDate: "2026-10-06T23:00:00Z",
  wa_postEndDate: "2026-10-13T22:59:00Z",
  WA_promotionSaleStartDate: "2026-10-07T00:00:00Z",
  WA_promotionSaleEndDate: "2026-10-13T23:59:59Z",
  finePrint: null,
  Terms: null,
  additionalDealInfo: "SAVE UP TO $2.00",
};
const payload = (overrides = {}) => ({ Savings: [{ ...offer, ...overrides }] });
const parse = (overrides = {}, now = at) =>
  parsePublixSavings(payload(overrides), "1825", at, new Date(now));
const item = { id: "eggs", name: "Eggs", quantity: 1, unit: "12 ct" };
const context = {
  retailer: "Publix",
  items: [item],
  stores: [],
  places: [],
  zip: "30303",
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(at));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("registers Publix and retains official offer evidence through ownership validation", () => {
  expect(scraperRegistry.get(" Publix ").id).toBe("publix");
  const products = parse();
  expect(products).toHaveLength(1);
  expect(products[0]).toMatchObject({
    name: "Pete & Gerry's Organic Brown Eggs",
    brand: "Pete and Gerry's",
    size: "12 ct",
    priceCents: 499,
    retrievedAt: at,
    sourceUrl:
      "https://www.publix.com/savings/weekly-ad?path=printlistingdetail/-2023386384&storenum=1825",
  });
  const report = {
    retailer: "Publix",
    status: "retrieved" as const,
    detail: "Catalog",
    lines: [{ item, products }],
  };
  expect(normalizeCatalogReport(report).lines[0].products[0]).toMatchObject({
    retailerId: "Publix",
    storeLocationId: null,
  });
  expect(
    normalizeCatalogReport({ ...report, retailer: "ALDI" }).lines[0].products,
  ).toEqual([]);
});

it("rejects conditional offers, rates, ambiguous sizes, malformed responses and invalid store context", () => {
  for (const overrides of [
    { savings: "Buy 1 Get 1 FREE" },
    { savings: "2 for $7.00" },
    { savings: "$4.99 lb" },
    { savings: "$1.00 off" },
    { savings: "€4.99" },
    { savings: "$0.00" },
    { savings: "$1001.00" },
    { savingType: "DigitalCoupon" },
    { minimumPurchase: 2 },
    { isSneakPeek: true },
    { finePrint: "With digital coupon" },
    { Terms: "Must buy 2" },
    { description: "12 ct with digital coupon" },
    { additionalDealInfo: "Members only" },
    { description: "6 or 12-ct. ctn." },
    { description: "6 to 12-ct. ctn." },
    { description: "6-12-ct. ctn." },
    { description: "2 x 12-ct. ctn." },
    { description: "12 ct or 24 ct" },
    { description: "Large, Grade A" },
    { description: "0-ct. ctn." },
  ])
    expect(parse(overrides)).toEqual([]);
  expect(() => parsePublixSavings({ error: "blocked" }, "1825", at)).toThrow(
    "readable",
  );
  expect(parsePublixSavings(payload(), "../../evil", at)).toEqual([]);
});

it("checks sale, posting and promotion dates when cached offers are read", () => {
  expect(parse({}, "2026-10-14T00:00:00Z")).toEqual([]);
  expect(parse({}, "2026-10-06T00:00:00Z")).toEqual([]);
  expect(parse({ wa_startDate: "invalid" })).toEqual([]);
  expect(parse({ WA_promotionSaleEndDate: "2026-10-09T23:59:59Z" })).toEqual(
    [],
  );
  expect(parse({ wa_endDate: "2026-10-09T23:59:59Z" })).toEqual([]);
});

async function freshAdapter() {
  vi.resetModules();
  return (await import("../lib/scrapers/publix")).publixScraper;
}
function mockPublic(
  options: {
    pageRules?: string;
    serviceRules?: string;
    serviceStatus?: number;
    badPage?: boolean;
  } = {},
) {
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url === "https://www.publix.com/robots.txt")
      return new Response(
        options.pageRules ?? "User-agent: *\nDisallow: /account/",
      );
    if (url === "https://services.publix.com/robots.txt")
      return new Response(options.serviceRules ?? "Not found", {
        status: options.serviceStatus ?? 404,
      });
    if (url.includes("/api/v4/savings")) return Response.json(payload());
    return new Response(
      options.badPage
        ? "Loading..."
        : '<weekly-ad-content-root :geolocated-store-number="1825"></weekly-ad-content-root>',
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

it("fetches one bounded anonymous ad for concurrent baskets and keeps its timestamp in cache", async () => {
  const adapter = await freshAdapter(),
    fetcher = mockPublic();
  const [a, b] = await Promise.all([
    adapter.scrape(context),
    adapter.scrape({ ...context, zip: "33101" }),
  ]);
  expect(a.status).toBe("retrieved");
  expect(b.status).toBe("retrieved");
  expect(fetcher).toHaveBeenCalledTimes(4);
  const apiCall = fetcher.mock.calls.find(([url]) =>
    String(url).includes("/api/v4/savings"),
  );
  expect(apiCall).toBeDefined();
  expect(
    (fetcher.mock.calls as unknown[][]).find(([url]) =>
      String(url).includes("/api/v4/savings"),
    )?.[1],
  ).toMatchObject({
    headers: { PublixStore: "1825" },
    redirect: "error",
    cache: "no-store",
  });
  vi.setSystemTime(new Date("2026-10-10T12:04:00Z"));
  const cached = await adapter.scrape(context);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(cached.lines[0].products[0].retrievedAt).toBe(
    new Date(at).toISOString(),
  );
  expect(cached.detail).toContain("branch prices and stock remain unverified");
  expect(adapter.checkBranches).toBeUndefined();
});

it("honors robots on both origins and fails closed on unavailable rules or missing store context", async () => {
  for (const options of [
    { pageRules: "User-agent: *\nDisallow: /savings/" },
    { serviceRules: "User-agent: *\nDisallow: /api/", serviceStatus: 200 },
    { serviceStatus: 503 },
    { serviceRules: "", serviceStatus: 200 },
    { badPage: true },
  ]) {
    const adapter = await freshAdapter(),
      fetcher = mockPublic(options);
    const result = await adapter.scrape(context);
    expect(result.status).toBe(
      options.pageRules !== undefined || options.serviceRules !== undefined
        ? "blocked"
        : "failed",
    );
    expect(result.lines[0].products).toEqual([]);
    expect(
      fetcher.mock.calls.some(([url]) =>
        String(url).includes("/api/v4/savings"),
      ),
    ).toBe(false);
  }
});

it("bounds response bytes and backs off after failures without inventing prices", async () => {
  const adapter = await freshAdapter();
  const fetcher = vi.fn(async () => new Response("x".repeat(100_001)));
  vi.stubGlobal("fetch", fetcher);
  expect((await adapter.scrape(context)).lines[0].error).toContain(
    "size limit",
  );
  await adapter.scrape(context);
  expect(fetcher).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date("2026-10-10T12:01:01Z"));
  await adapter.scrape(context);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("stops a shared fetch when its last caller cancels, and permits the next attempt", async () => {
  const adapter = await freshAdapter(),
    controller = new AbortController();
  let requestSignal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          requestSignal = options.signal;
          requestSignal!.addEventListener(
            "abort",
            () => reject(requestSignal!.reason),
            { once: true },
          );
        }),
    ),
  );
  const result = adapter.scrape({ ...context, signal: controller.signal });
  const rejected = expect(result).rejects.toThrow("cancelled");
  controller.abort(new Error("cancelled"));
  await rejected;
  expect(requestSignal?.aborted).toBe(true);
  mockPublic();
  expect((await adapter.scrape(context)).status).toBe("retrieved");
});

it.runIf(process.env.STRETCH_PUBLIX_LIVE_SMOKE === "1")(
  "retrieves real anonymous Publix weekly-ad package prices",
  async () => {
    vi.useRealTimers();
    const adapter = await freshAdapter();
    const result = await adapter.scrape(context);
    expect(result.status, JSON.stringify(result)).toBe("retrieved");
    expect(result.lines[0].products.length).toBeGreaterThan(0);
    console.log(JSON.stringify(result.lines[0].products[0]));
  },
  60_000,
);

it("keeps unrelated items unknown and limits results per basket", async () => {
  const adapter = await freshAdapter();
  mockPublic();
  const result = await adapter.scrape({
    ...context,
    items: [
      { ...item, name: "Milk" },
      ...Array.from({ length: 12 }, (_, i) => ({ ...item, id: String(i) })),
    ],
  });
  expect(result.lines[0].products).toEqual([]);
  expect(result.lines[12]).toMatchObject({
    products: [],
    searchStatus: "price_unavailable",
  });
});

it("propagates caller cancellation without cancelling another basket's shared request", async () => {
  const adapter = await freshAdapter();
  const fetcher = mockPublic(),
    controller = new AbortController();
  const first = adapter.scrape({ ...context, signal: controller.signal });
  const rejected = expect(first).rejects.toThrow("cancelled");
  const second = adapter.scrape(context);
  controller.abort(new Error("cancelled"));
  await rejected;
  expect((await second).status).toBe("retrieved");
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("preserves the configured hosted collector and its streaming options", async () => {
  const adapter = await freshAdapter();
  const provider = await import("../lib/provider-prices");
  vi.mocked(provider.providerSupports).mockReturnValueOnce(true);
  const report = {
    retailer: "Publix",
    status: "pending" as const,
    detail: "Hosted collection running",
    lines: [{ item, products: [] }],
  };
  vi.mocked(provider.providerReports).mockResolvedValueOnce([report]);
  const fetcher = mockPublic(),
    onReport = vi.fn();
  expect(await adapter.scrape({ ...context, fast: true, onReport })).toEqual(
    report,
  );
  expect(provider.providerReports).toHaveBeenCalledWith(
    ["Publix"],
    [item],
    "30303",
    true,
    false,
    onReport,
    undefined,
    false,
    undefined,
    { fast: true },
  );
  expect(fetcher).not.toHaveBeenCalled();
});
