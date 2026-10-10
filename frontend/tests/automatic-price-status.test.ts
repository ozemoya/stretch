import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("../lib/provider-prices", () => ({ providerReports: vi.fn(async () => []) }));
vi.mock("../lib/live-data", () => ({ nearbyPlaces: vi.fn(async () => ({ places: [], origin: { label: "Downtown" } })) }));
vi.mock("../lib/retailer-coverage", () => ({ groceryCoverage: vi.fn(() => [
  { id: "branch", retailer: "Kroger family", name: "Kroger", address: "800 Glenwood", lat: 33.7, lon: -84.3 },
  { id: "target", retailer: "Target", name: "Target", address: "Caroline Street", lat: 33.7, lon: -84.3 },
]) }));
vi.mock("../lib/retailer-scraper", () => ({
  scrapeBranches: vi.fn(async () => ({ stores: [{ id: "branch", name: "Kroger", lines: [] }], warnings: [] })),
  scrapeRetailers: vi.fn(async () => []),
}));
vi.mock("../lib/scrapers/persistence", () => ({ catalogPriceBatch: vi.fn(), branchPriceBatch: vi.fn(() => ({})) }));
import { POST } from "../app/api/live/provider-status/route";
import { scrapeBranches, scrapeRetailers } from "../lib/retailer-scraper";
import { providerReports } from "../lib/provider-prices";
const body = { zip: "30303", items: [{ id: "eggs", name: "Eggs", unit: "12 count", quantity: 1 }],
  retailers: ["Target"], stream: true, poll: true, location: { area: "downtown", radius: 5 } };
const request = (extra = {}) => new Request("http://localhost/api/live/provider-status", {
  method: "POST", body: JSON.stringify({ ...body, ...extra }),
});
afterEach(() => { vi.clearAllMocks(); vi.useRealTimers(); });
it("streams newly available branch results and map coverage during polling", async () => {
  const response = await POST(request());
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  expect(events.find(event => event.type === "coverage").storeCoverage).toHaveLength(2);
  expect(events.find(event => event.type === "branches").stores[0].id).toBe("branch");
  expect(events.at(-1).branchesFinished).toBe(true);
  expect(vi.mocked(providerReports).mock.calls[0][3]).toBe(false);
});
it("initializes a missed source without restarting the other hosted jobs", async () => {
  await (await POST(request({ missingRetailers: ["Target"] }))).text();
  expect(vi.mocked(providerReports).mock.calls[0][0]).toEqual([]);
  expect(vi.mocked(scrapeRetailers).mock.calls[0][0].map(store => store.retailer)).toEqual(["Target"]);
});
it("marks slow branch checks unfinished so the browser continues polling", async () => {
  vi.useFakeTimers();
  vi.mocked(scrapeBranches).mockImplementationOnce(async () => new Promise(() => {}));
  const text = (await POST(request())).text();
  await vi.advanceTimersByTimeAsync(4000);
  const events = (await text).trim().split("\n").map(line => JSON.parse(line));
  expect(events.at(-1).timedOut).toBe(true);
  expect(events.at(-1).branchesFinished).toBe(false);
});
