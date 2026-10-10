import { afterEach, expect, it, vi } from "vitest";
import { discoverSources } from "../lib/ai-source-search";

vi.mock("../lib/provider-budget", () => ({ reserveRecords: vi.fn(async () => {}) }));
const originalFetch = globalThis.fetch;
const originalKey = process.env.BRIGHT_DATA_API_KEY;
const originalZone = process.env.BRIGHT_DATA_SERP_ZONE;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.BRIGHT_DATA_API_KEY;
  else process.env.BRIGHT_DATA_API_KEY = originalKey;
  if (originalZone === undefined) delete process.env.BRIGHT_DATA_SERP_ZONE;
  else process.env.BRIGHT_DATA_SERP_ZONE = originalZone;
});

it("uses the local agent's food query when the first retailer search misses", async () => {
  process.env.BRIGHT_DATA_API_KEY = "test-only";
  process.env.BRIGHT_DATA_SERP_ZONE = "test-only";
  const queries: string[] = [];
  globalThis.fetch = vi.fn(async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    queries.push(new URL(request.url).searchParams.get("q") ?? "");
    return Response.json({ organic: queries.length === 1 ? [] : [
      { link: "https://www.instacart.com/store/aldi/products/115095-goldhen-grade-a-large-eggs-12-ct" },
    ] });
  }) as typeof fetch;
  const result = await discoverSources("ALDI", { id: "eggs", name: "eggs", unit: "dozen", quantity: 1 }, "30303", {
    provider: "local-ai", model: "llama3.2:3b", queries: { eggs: ["large grade a eggs 12 count"] },
  });
  expect(queries).toHaveLength(2);
  expect(queries[1]).toContain("large grade a eggs 12 count");
  expect(result).toHaveLength(1);
});
