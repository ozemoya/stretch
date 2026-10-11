import { afterEach, expect, it, vi } from "vitest";
import { getCatalog } from "../lib/catalog";
import sample from "../lib/sample-catalog.json";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("loads database location keys when scrapers add more than three branches", async () => {
  vi.stubEnv("BACKEND_API_URL", "http://localhost:8000");
  const stores = Array.from({ length: 4 }, (_, i) => ({
    id: `kroger:branch:${1100672 + i}`, name: `Kroger ${i}`,
  }));
  const offers = [{
    ...sample.offers[0],
    recordedAt: "2026-10-10T00:00:00+00:00",
    storeId: stores[3].id,
    isSample: false,
  }];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...sample, stores, offers })));
  const result = await getCatalog();
  expect(result.source).toBe("supabase");
  expect(result.catalog.stores).toEqual(stores);
  expect(result.catalog.offers).toEqual(offers);
});
