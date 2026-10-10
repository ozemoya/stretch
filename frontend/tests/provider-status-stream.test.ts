import { afterEach, expect, it, vi } from "vitest";
import type { ScrapeReport } from "../lib/retailer-scraper";

const item = { id: "milk", name: "milk", unit: "gallon", quantity: 1 };
const report: ScrapeReport = {
  retailer: "Target", status: "pending", detail: "Collecting",
  lines: [{ item, products: [], searchStatus: "searching" }],
};
vi.mock("../lib/provider-prices", () => ({
  providerReports: vi.fn(async (_retailers: unknown, _items: unknown, _zip: unknown,
    _start: unknown, _cacheOnly: unknown, onReport?: (report: ScrapeReport) => void) => {
    onReport?.(report);
    return [report];
  }),
}));

import { POST } from "../app/api/live/provider-status/route";
import { providerReports } from "../lib/provider-prices";
import { SEARCH_WINDOW_MS } from "../lib/search-timing";
afterEach(() => vi.useRealTimers());

it("streams each retailer update before refresh completes", async () => {
  const response = await POST(new Request("http://localhost/api/live/provider-status", {
    method: "POST",
    body: JSON.stringify({ zip: "30303", items: [item], retailers: ["Target"], stream: true }),
  }));
  expect(response.headers.get("content-type")).toBe("application/x-ndjson");
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  expect(events.map((event) => event.type)).toEqual(["report", "report", "complete"]);
  expect(events[0].report.retailer).toBe("Target");
});

it("ends a stuck manual refresh at the search deadline", async () => {
  vi.useFakeTimers();
  vi.mocked(providerReports).mockImplementationOnce(async (_retailers, _items, _zip, _start, _cacheOnly, onReport) => {
    onReport?.(report);
    return new Promise(() => {});
  });
  const response = await POST(new Request("http://localhost/api/live/provider-status", {
    method: "POST", body: JSON.stringify({ zip: "30303", items: [item], retailers: ["Target"], stream: true }),
  }));
  const text = response.text();
  await vi.advanceTimersByTimeAsync(SEARCH_WINDOW_MS);
  const events = (await text).trim().split("\n").map(line => JSON.parse(line));
  expect(events.at(-1).timedOut).toBe(true);
  expect(events.at(-1).reports[0].lines[0].searchStatus).toBe("timeout");
});
