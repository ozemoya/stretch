import { z } from "zod";
import type { AgentItem, StoreCheck } from "./price-agent";
import type { StoreCoverage } from "./retailer-coverage";
const candidate = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  brand: z.string(),
  size: z.string(),
  soldBy: z.enum(["UNIT", "WEIGHT"]),
  regularCents: z.number().int().positive().nullable(),
  retrievedAt: z.string().datetime(),
});
const feedSchema = z.object({
  currency: z.literal("USD"),
  priceType: z.literal("in_store"),
  source: z.string().min(1).max(100),
  stores: z
    .array(
      z.object({
        id: z.string(),
        lines: z
          .array(
            z.object({
              itemId: z.string(),
              candidates: z.array(candidate).max(20),
            }),
          )
          .max(30),
      }),
    )
    .max(2000),
});
export function normalizeFeed(
  raw: unknown,
  coverage: StoreCoverage[],
  items: AgentItem[],
  now = new Date(),
) {
  const data = feedSchema.parse(raw);
  const seen = new Set<string>();
  const stores: StoreCheck[] = [];
  for (const s of data.stores) {
    const local = coverage.find((c) => c.id === s.id);
    if (!local || seen.has(s.id)) continue;
    seen.add(s.id);
    stores.push({
      id: s.id,
      name: local.name,
      address: local.address,
      lines: items.map((item) => {
        const line = s.lines.find((l) => l.itemId === item.id);
        return {
          item,
          candidates: (line?.candidates ?? []).filter((p) => {
            const age = now.getTime() - Date.parse(p.retrievedAt);
            return age >= -300000 && age <= 24 * 3600000;
          }),
        };
      }),
    });
  }
  return { source: data.source, stores };
}
export async function groceryFeed(
  coverage: StoreCoverage[],
  items: AgentItem[],
) {
  const configured = process.env.GROCERY_PRICE_FEED_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Price feed must use HTTPS without URL credentials.");
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.GROCERY_PRICE_FEED_KEY
        ? { Authorization: `Bearer ${process.env.GROCERY_PRICE_FEED_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      stores: coverage.map((s) => ({
        id: s.id,
        name: s.name,
        address: s.address,
      })),
      items,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    redirect: "error",
  });
  if (!r.ok) throw new Error("Price feed unavailable.");
  const text = await r.text();
  if (text.length > 2000000) throw new Error("Price feed response too large.");
  return normalizeFeed(JSON.parse(text), coverage, items);
}
