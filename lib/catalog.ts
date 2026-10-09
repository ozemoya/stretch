import { createClient } from "@supabase/supabase-js";
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
  stores: z.array(z.object({ id: z.string(), name: z.string() })).length(3),
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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return { catalog: schema.parse(sample), source: "demo" };
  try {
    const db = createClient(url, key, {
      auth: { persistSession: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.timeout(8000),
            cache: "no-store",
          }),
      },
    });
    const results = await Promise.all(
      ["products", "stores", "offers", "substitutions"].map((table) =>
        db.from(table).select("*").order("id"),
      ),
    );
    for (const r of results) if (r.error) throw r.error;
    const [products, stores, offers, swaps] = results.map((x) => x.data!);
    const catalog = schema.parse({
      products: products.map((p) => ({
        ...p,
        glutenFree: p.gluten_free,
        nutFree: p.nut_free,
      })),
      stores,
      offers: offers.map((o) => ({
        productId: o.product_id,
        storeId: o.store_id,
        priceCents: o.price_cents,
        recordedAt: new Date(o.recorded_at).toISOString(),
        isSample: o.is_sample,
        available: o.available,
      })),
      swaps: swaps.map((s) => ({
        fromId: s.from_id,
        toId: s.to_id,
        note: s.note,
      })),
    });
    // Keep the starter basket consistent when switching between data sources.
    const productOrder = new Map(sample.products.map((p, i) => [p.id, i]));
    catalog.products.sort(
      (a, b) => (productOrder.get(a.id) ?? Infinity) - (productOrder.get(b.id) ?? Infinity),
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
