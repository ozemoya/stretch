import { z } from "zod";
import sample from "./sample-catalog.json";
import type { Catalog } from "./types";
const schema = z.object({
  products: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        emoji: z.string(),
        category: z.string(),
        unit: z.string(),
        vegan: z.boolean(),
        glutenFree: z.boolean(),
        nutFree: z.boolean(),
      }),
    )
    .min(1),
  stores: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
  offers: z.array(
    z.object({
      productId: z.string(),
      storeId: z.string(),
      priceCents: z.number().int().nonnegative(),
      recordedAt: z.iso.datetime(),
      isSample: z.boolean(),
      available: z.boolean(),
    }),
  ),
  swaps: z.array(
    z.object({ fromId: z.string(), toId: z.string(), note: z.string() }),
  ),
});
export async function getCatalog(): Promise<{
  catalog: Catalog;
  source: "demo" | "supabase";
  error?: string;
}> {
  const apiUrl = process.env.BACKEND_API_URL;
  if (!apiUrl) return { catalog: schema.parse(sample), source: "demo" };
  try {
    const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/catalog`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Catalog API returned ${response.status}`);
    const catalog = schema.parse(await response.json());
    // Keep the starter basket consistent when switching between data sources.
    const productOrder = new Map(sample.products.map((p, i) => [p.id, i]));
    catalog.products.sort(
      (a, b) =>
        (productOrder.get(a.id) ?? Infinity) -
        (productOrder.get(b.id) ?? Infinity),
    );
    return { catalog, source: "supabase" };
  } catch {
    return {
      catalog: schema.parse(sample),
      source: "demo",
      error:
        "The database could not be loaded. Showing labeled demo data instead.",
    };
  }
}
