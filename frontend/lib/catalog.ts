import { z } from "zod";
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
  stores: z.array(z.object({
    id: z.string(),
    name: z.string(),
    address: z.string().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
  })).min(1),
  offers: z.array(
    z.object({
      productId: z.string(),
      storeId: z.string(),
      priceCents: z.number().int().nonnegative(),
      recordedAt: z.iso.datetime({ offset: true }),
      isSample: z.boolean(),
      available: z.boolean(),
      productName: z.string().nullable().optional(),
      packageSize: z.string().nullable().optional(),
      sourceUrl: z.string().nullable().optional(),
      priceSource: z.string().nullable().optional(),
      unitBasis: z.string().nullable().optional(),
      requestedUnit: z.string().nullable().optional(),
    }),
  ),
  swaps: z.array(
    z.object({ fromId: z.string(), toId: z.string(), note: z.string() }),
  ),
});
export async function getCatalog(): Promise<{
  catalog: Catalog;
  source: "supabase";
  error?: string;
}> {
  const apiUrl = process.env.BACKEND_API_URL;
  if (!apiUrl) throw new Error("BACKEND_API_URL is required for Supabase catalog results.");
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/api/catalog`, {
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Catalog API returned ${response.status}`);
  return { catalog: schema.parse(await response.json()), source: "supabase" };
}
