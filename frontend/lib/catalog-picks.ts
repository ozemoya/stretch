import { z } from "zod";
import type { AgentItem } from "./price-agent";
import { catalogSourceBelongsToRetailer, type OwnedCatalogProduct } from "./product-ownership";

export const CATALOG_PICKS_KEY = "stretch.catalog-picks.v1";

const schema = z.object({
  id: z.string().min(1), itemId: z.string().min(1), requestedName: z.string().min(1),
  retailerId: z.string().min(1), productId: z.string().min(1), productName: z.string().min(1),
  brand: z.string(), size: z.string(), quantity: z.number().int().min(1).max(99),
  onlinePriceCents: z.number().int().positive(), priceSource: z.string().min(1),
  observedAt: z.string().datetime(), productUrl: z.url().startsWith("https://"),
  imageUrl: z.url().startsWith("https://").optional(),
  storeLocationId: z.null(),
});
export type CatalogPick = z.infer<typeof schema>;

export function catalogPick(item: AgentItem, product: OwnedCatalogProduct): CatalogPick | null {
  const result = schema.safeParse({
    id: `${item.id}:${product.retailerId}:${product.productId}`,
    itemId: item.id, requestedName: item.name, retailerId: product.retailerId,
    productId: product.productId, productName: product.productName, brand: product.brand,
    size: product.size, quantity: item.quantity, onlinePriceCents: product.priceCents,
    priceSource: product.priceSource, observedAt: product.verifiedAt,
    productUrl: product.productUrl,
    imageUrl: product.imageUrl?.startsWith("https://") ? product.imageUrl : undefined,
    storeLocationId: null,
  });
  return result.success && validCatalogPick(result.data) ? result.data : null;
}

export function validCatalogPick(pick: CatalogPick): boolean {
  return catalogSourceBelongsToRetailer(pick.retailerId, pick.productUrl) &&
    Number.isFinite(Date.parse(pick.observedAt));
}

export function parseCatalogPicks(value: unknown): CatalogPick[] {
  const parsed = z.array(schema).max(50).safeParse(value);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  return parsed.data.filter((pick) => {
    if (!validCatalogPick(pick) || seen.has(pick.id)) return false;
    seen.add(pick.id);
    return true;
  });
}

export function readCatalogPicks(storage: Pick<Storage, "getItem">): CatalogPick[] {
  try { return parseCatalogPicks(JSON.parse(storage.getItem(CATALOG_PICKS_KEY) || "[]")); }
  catch { return []; }
}

export function writeCatalogPicks(storage: Pick<Storage, "setItem">, picks: CatalogPick[]): boolean {
  if (parseCatalogPicks(picks).length !== picks.length) return false;
  try { storage.setItem(CATALOG_PICKS_KEY, JSON.stringify(picks)); return true; }
  catch { return false; }
}

export function addCatalogPick(picks: CatalogPick[], incoming: CatalogPick): CatalogPick[] {
  if (!validCatalogPick(incoming)) return picks;
  const existing = picks.find((pick) => pick.id === incoming.id);
  if (!existing) return picks.length < 50 ? [...picks, incoming] : picks;
  return picks.map((pick) => pick.id === incoming.id ? {
    ...incoming, quantity: Math.min(99, pick.quantity + incoming.quantity),
  } : pick);
}

export function catalogReferenceSubtotal(picks: CatalogPick[]): number {
  return picks.reduce((sum, pick) => sum + (validCatalogPick(pick) ? pick.onlinePriceCents * pick.quantity : 0), 0);
}
