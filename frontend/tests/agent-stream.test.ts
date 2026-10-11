import { afterEach, beforeEach, it, expect, vi } from "vitest";
vi.mock("../lib/scrapers/save-after-response", () => ({ savePricesAfterResponse: vi.fn() }));
const item = { id: "milk", name: "milk", unit: "gallon", quantity: 1 };
const report = { retailer: "Target", status: "retrieved" as const, detail: "Catalog price", lines: [{ item,
  products: [{ id: "p", name: "Milk", brand: "Target", size: "1 gallon", priceCents: 329,
    sourceUrl: "https://www.target.com/p/milk", retrievedAt: "2026-10-09T12:00:00Z" }] }] };
vi.mock("../lib/trader-joes", () => ({ traderJoesObserved: () => [] }));
vi.mock("../lib/catalog-cache", () => ({ catalogCache: { read: () => [], put: vi.fn() } }));
vi.mock("../lib/local-search-agent", () => ({ planBasketSearch: vi.fn() }));
vi.mock("../lib/live-data", () => ({ googleNearbyPlaces: vi.fn() }));
vi.mock("../lib/retailer-coverage", () => ({ groceryCoverage: () => [{ id: "target-1", retailer: "Target" }] }));
vi.mock("../lib/retailer-scraper", () => ({ scrapeRetailers: vi.fn() }));
vi.mock("../lib/provider-prices", () => ({ providerReports: vi.fn() }));
vi.mock("../lib/compare-basket", async () => {
  const { z } = await import("zod");
  return { input: z.object({ items: z.array(z.object({ id: z.string(), name: z.string(), unit: z.string(), quantity: z.number() })),
    zip: z.string(), area: z.string().default("downtown"), radius: z.number().default(5) }), compareBasket: vi.fn() };
});
import { POST } from "../app/api/agent/search/route";
import { planBasketSearch } from "../lib/local-search-agent";
import { providerReports } from "../lib/provider-prices";
import { scrapeRetailers } from "../lib/retailer-scraper";
import { googleNearbyPlaces } from "../lib/live-data";
import { compareBasket } from "../lib/compare-basket";
import { SEARCH_WINDOW_MS } from "../lib/search-timing";

const request = (signal?: AbortSignal) => new Request("http://localhost/api/agent/search", {
  method: "POST", body: JSON.stringify({ zip: "30303", items: [item] }), signal,
});
const parse = (text: string) => text.trim().split("\n").map(line => JSON.parse(line));
beforeEach(() => {
  vi.mocked(planBasketSearch).mockReset().mockResolvedValue({ provider: "openai", model: "test", queries: { milk: ["whole milk gallon"] } });
  vi.mocked(googleNearbyPlaces).mockReset().mockResolvedValue({ places: [], origin: { label: "Atlanta" } } as never);
  vi.mocked(compareBasket).mockReset().mockResolvedValue(Response.json({ stores: [], publicCatalogs: [],
    storeCoverage: [{ id: "target-1", retailer: "Target" }], foundStores: 1, warnings: [] }));
  vi.mocked(scrapeRetailers).mockReset().mockImplementation(async (_stores, _items, _places, _plan, _signal, onReport) => {
    onReport?.(report); return [report];
  });
  vi.mocked(providerReports).mockReset().mockImplementation(async (_retailers, _items, _zip, _start, _cacheOnly, onReport) => {
    onReport?.(report); return [report];
  });
});
afterEach(() => vi.useRealTimers());

it("streams real cached prices immediately and finishes with the collected prices, not just map discovery", async () => {
  const response = await POST(request());
  const events = parse(await response.text());
  expect(response.headers.get("content-type")).toBe("application/x-ndjson");
  const cached = events.find(event => event.type === "report" && event.cached);
  expect(cached.report.lines[0].products[0].priceCents).toBe(329);
  expect(cached.report.lines[0].products[0].retrievedAt).toBe("2026-10-09T12:00:00Z");
  const complete = events.find(event => event.type === "complete");
  expect(complete.result.publicCatalogs[0].lines[0].products).toHaveLength(1);
  expect(events.at(-1).type).toBe("sources-complete");
  expect(complete.result.search.partial).toBe(false);
});

it("rejects duplicate items before collection", async () => {
  const response = await POST(new Request("http://localhost/api/agent/search", { method: "POST",
    body: JSON.stringify({ zip: "30303", items: [item, item] }) }));
  expect(response.status).toBe(400);
  expect(providerReports).not.toHaveBeenCalled();
});

it("ends the entire response at the search deadline even when AI and a retailer ignore abort", async () => {
  vi.useFakeTimers();
  vi.mocked(planBasketSearch).mockImplementation(() => new Promise(() => {}));
  let sourceSignal: AbortSignal | undefined;
  let late: (() => void) | undefined;
  vi.mocked(scrapeRetailers).mockImplementation(async (_stores, _items, _places, _plan, signal, onReport) => {
    sourceSignal = signal;
    onReport?.({ ...report, status: "pending", lines: [{ item, products: [], searchStatus: "searching" }] });
    await new Promise<void>(resolve => { late = () => { onReport?.(report); resolve(); }; });
    return [report];
  });
  const response = await POST(request());
  const text = response.text();
  await vi.advanceTimersByTimeAsync(SEARCH_WINDOW_MS);
  const events = parse(await text);
  expect(events.at(-1).timedOut).toBe(true);
  expect(events.at(-1).elapsedMs).toBeLessThan(SEARCH_WINDOW_MS + 1000);
  expect(sourceSignal?.aborted).toBe(true);
  expect(events.find(event => event.type === "complete").result.publicCatalogs[0].lines[0].products[0].priceCents).toBe(329);
  expect(() => late?.()).not.toThrow();
});

it("returns cached evidence and an honest partial result when map discovery hangs", async () => {
  vi.useFakeTimers();
  vi.mocked(googleNearbyPlaces).mockImplementation(() => new Promise(() => {}));
  vi.mocked(compareBasket).mockImplementation(() => new Promise(() => {}));
  const response = await POST(request());
  const text = response.text();
  await vi.advanceTimersByTimeAsync(SEARCH_WINDOW_MS);
  const result = parse(await text).find(event => event.type === "complete").result;
  expect(result.foundStores).toBe(0);
  expect(result.stores).toEqual([]);
  expect(result.search.partial).toBe(true);
  expect(result.publicCatalogs[0].lines[0].products[0].priceCents).toBe(329);
  expect(result.coverage).toContain("did not finish");
});

it("reports a nearby-store lookup limit instead of presenting an empty search as success", async () => {
  vi.mocked(googleNearbyPlaces).mockRejectedValue(new Error("Live-data request limit reached. Please try again later."));
  const response = await POST(request());
  const complete = parse(await response.text()).find(event => event.type === "complete").result;
  expect(complete.search.partial).toBe(true);
  expect(complete.search.locationError).toContain("request limit reached");
  expect(complete.stores).toEqual([]);
});

it("stops unfinished item loading states while retaining verified matches", async () => {
  vi.useFakeTimers();
  vi.mocked(providerReports).mockImplementation(async (_retailers, _items, _zip, _start, cacheOnly, onReport) => {
    if (cacheOnly) return [];
    onReport?.({ ...report, status: "pending", lines: [{ item, products: [], searchStatus: "searching" }] });
    return new Promise(() => {});
  });
  vi.mocked(scrapeRetailers).mockResolvedValue([]);
  const response = await POST(request());
  const text = response.text();
  await vi.advanceTimersByTimeAsync(SEARCH_WINDOW_MS);
  const result = parse(await text).find(event => event.type === "complete").result;
  expect(result.publicCatalogs[0].lines[0].searchStatus).toBe("timeout");
  expect(result.publicCatalogs[0].status).toBe("failed");
});

it("checks an existing provider job again and streams its price in the same search", async () => {
  vi.useFakeTimers();
  const pending = { ...report, status: "pending" as const, lines: [{ item, products: [], searchStatus: "searching" as const }] };
  vi.mocked(providerReports).mockImplementation(async (_retailers, _items, _zip, start, cacheOnly, onReport) => {
    if (cacheOnly) return [];
    const next = start ? pending : report;
    onReport?.(next);
    return [next];
  });
  const response = await POST(request());
  const text = response.text();
  await vi.advanceTimersByTimeAsync(5_000);
  const events = parse(await text);
  expect(vi.mocked(providerReports).mock.calls.some((call) => call[3] === false && call[4] === false)).toBe(true);
  expect(events.find((event) => event.type === "complete").result.publicCatalogs[0].lines[0].products[0].priceCents).toBe(329);
  expect(events.at(-1).timedOut).toBe(false);
});
