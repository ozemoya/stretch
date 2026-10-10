import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ saved: "" }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async () => state.saved),
  writeFile: vi.fn(async () => undefined),
}));
vi.mock("../lib/provider-budget", () => ({ reserveRecords: vi.fn(async () => undefined) }));
import { providerReports } from "../lib/provider-prices";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it("reads saved prices immediately even while the same item has a slow refresh in flight", async () => {
  vi.stubEnv("BRIGHT_DATA_API_KEY", "test-key");
  const now = Date.now();
  const item = { id: "milk", name: "milk", unit: "1 gallon", quantity: 1 };
  state.saved = JSON.stringify({ id: "s_test", status: "running", started: now - 30_000, checked: now - 20_000,
    products: [{ id: "milk", name: "Whole Milk", brand: "Store", size: "1 gallon", priceCents: 329,
      sourceUrl: "https://www.walmart.com/ip/milk/12345", retrievedAt: new Date(now - 60_000).toISOString() }] });
  const controller = new AbortController();
  const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Canceled", "AbortError")), { once: true });
  }));
  vi.stubGlobal("fetch", fetchMock);
  const live = providerReports(["Walmart"], [item], "30303", true, false, undefined, undefined, false, controller.signal);
  try {
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const cached = await Promise.race([
      providerReports(["Walmart"], [item], "30303", false, true),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("Cache waited on the network lock")), 200)),
    ]);
    expect(cached[0].lines[0].products[0].priceCents).toBe(329);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    controller.abort();
    await expect(live).rejects.toHaveProperty("name", "AbortError");
  }
});
