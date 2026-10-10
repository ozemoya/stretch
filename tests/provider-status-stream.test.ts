import { expect, it, vi } from "vitest";
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
