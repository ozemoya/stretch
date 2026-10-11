import { z } from "zod";
import { ownedCandidate, type AgentItem, type Candidate, type StoreCheck } from "./price-agent";
import { packageMatches } from "./package-match";
import type { StoreCoverage } from "./retailer-coverage";

export const SMART_CART_KEY = "stretch.smart-cart.v1";
export const SMART_CART_EVENT = "stretch:cart-change";
export const CART_OPTIONS_KEY = "stretch.cart-options.v1";

const itemSchema = z.object({ id: z.string().min(1), name: z.string().min(1), unit: z.string(), quantity: z.number().int().min(1).max(99) });
const productSchema = z.object({
  id: z.string().min(1), name: z.string(), brand: z.string(), size: z.string(), soldBy: z.string(),
  regularCents: z.number().int().positive(), retrievedAt: z.string(), retailerId: z.string().min(1),
  storeLocationId: z.string().min(1), productId: z.string().min(1), productName: z.string().min(1),
  price: z.number().positive(), priceSource: z.string().min(1), verifiedAt: z.string().datetime(),
  productUrl: z.url().nullable(), imageUrl: z.string().optional(), imageSourceUrl: z.string().optional(),
  priceKind: z.enum(["branch_advertised", "branch_catalog"]).optional(),
  matchKind: z.enum(["exact", "comparable", "uncertain"]).optional(), upc: z.string().optional(),
});
const storeSchema = z.object({ id: z.string().min(1), retailerId: z.string().min(1), name: z.string().min(1),
  address: z.string(), lat: z.number().finite(), lon: z.number().finite(), mapUrl: z.url() });
const lineSchema = z.object({ id: z.string().min(1), item: itemSchema, product: productSchema, store: storeSchema,
  quantity: z.number().int().min(1).max(99), selected: z.boolean().default(true), addedAt: z.string().datetime() });

export type CartLine = z.infer<typeof lineSchema>;
export type CartStore = CartLine["store"];

export function cartLine(item: AgentItem, product: Candidate, store: StoreCheck, location: StoreCoverage,
  at = new Date().toISOString()): CartLine | null {
  if (store.id !== location.id || !ownedCandidate(store, product) || product.soldBy !== "UNIT" ||
    !packageMatches(item.unit, product.size)) return null;
  const result = lineSchema.safeParse({
    id: `${item.id}:${store.retailerId}:${store.id}:${product.productId}`, item, product,
    store: { id: store.id, retailerId: store.retailerId, name: store.name,
      address: store.address || location.address, lat: location.lat, lon: location.lon, mapUrl: location.mapUrl },
    quantity: item.quantity, selected: true, addedAt: at,
  });
  return result.success && validCartLine(result.data) ? result.data : null;
}

export function validCartLine(line: CartLine): boolean {
  return line.product.retailerId === line.store.retailerId && line.product.storeLocationId === line.store.id &&
    line.product.regularCents === Math.round(line.product.price * 100) &&
    packageMatches(line.item.unit, line.product.size) && line.product.soldBy === "UNIT" &&
    Number.isFinite(Date.parse(line.product.verifiedAt));
}

export function parseCart(value: unknown): CartLine[] {
  const parsed = z.array(lineSchema).max(30).safeParse(value);
  if (!parsed.success) return [];
  const ids = new Set<string>();
  return parsed.data.filter((line) => {
    if (!validCartLine(line) || ids.has(line.id)) return false;
    ids.add(line.id);
    return true;
  });
}

export function readCart(storage: Pick<Storage, "getItem">): CartLine[] {
  try { return parseCart(JSON.parse(storage.getItem(SMART_CART_KEY) || "[]")); }
  catch { return []; }
}

export function writeCart(storage: Pick<Storage, "setItem">, lines: CartLine[]): boolean {
  const parsed = parseCart(lines);
  if (parsed.length !== lines.length) return false;
  try { storage.setItem(SMART_CART_KEY, JSON.stringify(parsed)); return true; }
  catch { return false; }
}

export function addCartLine(lines: CartLine[], incoming: CartLine): CartLine[] {
  if (!validCartLine(incoming)) return lines;
  const existing = lines.find((line) => line.id === incoming.id);
  if (!existing) return lines.length < 30 ? [...lines, incoming] : lines;
  return lines.map((line) => line.id === incoming.id
    ? { ...line, quantity: Math.min(99, line.quantity + incoming.quantity), product: incoming.product } : line);
}

export function readCartOptions(storage: Pick<Storage, "getItem">): CartLine[] {
  try {
    const parsed = z.array(lineSchema).max(200).safeParse(JSON.parse(storage.getItem(CART_OPTIONS_KEY) || "[]"));
    return parsed.success ? parsed.data.filter(validCartLine) : [];
  } catch { return []; }
}

export function writeCartOptions(storage: Pick<Storage, "setItem">, options: CartLine[]): boolean {
  const valid = z.array(lineSchema).max(200).safeParse(options);
  if (!valid.success || valid.data.some((line) => !validCartLine(line))) return false;
  try { storage.setItem(CART_OPTIONS_KEY, JSON.stringify(valid.data)); return true; }
  catch { return false; }
}

export function replacementOptions(line: CartLine, options: CartLine[]): CartLine[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (option.item.id !== line.item.id || option.item.name !== line.item.name || option.item.unit !== line.item.unit ||
      option.id === line.id || !validCartLine(option) || seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  }).sort((a, b) => a.product.regularCents - b.product.regularCents);
}

export function replaceCartLine(lines: CartLine[], targetId: string, replacement: CartLine): CartLine[] {
  const target = lines.find((line) => line.id === targetId);
  if (!target || replacement.item.id !== target.item.id || replacement.item.name !== target.item.name ||
    replacement.item.unit !== target.item.unit || !validCartLine(replacement)) return lines;
  const without = lines.filter((line) => line.id !== targetId);
  return addCartLine(without, { ...replacement, quantity: target.quantity, selected: target.selected });
}

export function cartSubtotal(lines: CartLine[]): number {
  return lines.reduce((sum, line) => sum + (line.selected && validCartLine(line) ? line.product.regularCents * line.quantity : 0), 0);
}

export function cartGroups(lines: CartLine[]) {
  const groups = new Map<string, { store: CartStore; lines: CartLine[]; subtotalCents: number }>();
  for (const line of lines) {
    if (!line.selected || !validCartLine(line)) continue;
    const group = groups.get(line.store.id) ?? { store: line.store, lines: [], subtotalCents: 0 };
    group.lines.push(line);
    group.subtotalCents += line.product.regularCents * line.quantity;
    groups.set(line.store.id, group);
  }
  return [...groups.values()];
}
