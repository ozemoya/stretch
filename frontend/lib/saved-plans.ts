import { z } from "zod";
import type { BasketItem, Preferences } from "./types";
import type { SearchOrigin } from "./locations";

export const SAVED_LISTS_KEY = "stretch.saved-lists.v1";
export const SAVED_SETTINGS_KEY = "stretch.saved-settings.v1";

const preferencesSchema = z.object({
  area: z.enum(["downtown", "midtown", "decatur"]),
  budget: z.number().finite().nonnegative(),
  mpg: z.number().finite().positive(),
  gas: z.number().finite().nonnegative(),
  maxStops: z.number().int().min(1).max(2),
  vegan: z.boolean(), glutenFree: z.boolean(), nutFree: z.boolean(),
});
const originSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  label: z.string().min(1).max(100),
  zip: z.string().optional(),
});
const basketSchema = z.array(z.object({
  productId: z.string().min(1), quantity: z.number().int().min(1).max(99),
})).min(1).max(30).refine((items) => new Set(items.map((item) => item.productId)).size === items.length);
const settingsSchema = z.object({
  prefs: preferencesSchema,
  manualOrigin: originSchema.nullable(),
});
const savedListSchema = settingsSchema.extend({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(60),
  savedAt: z.string().datetime(),
  basket: basketSchema,
});

export type SavedSettings = { prefs: Preferences; manualOrigin: SearchOrigin | null };
export type SavedList = SavedSettings & { id: string; name: string; savedAt: string; basket: BasketItem[] };

export function readSavedSettings(storage: Pick<Storage, "getItem">): SavedSettings | null {
  try { const raw = storage.getItem(SAVED_SETTINGS_KEY); return raw ? settingsSchema.parse(JSON.parse(raw)) : null; }
  catch { return null; }
}

export function writeSavedSettings(storage: Pick<Storage, "setItem">, value: SavedSettings): boolean {
  const parsed = settingsSchema.safeParse(value);
  if (!parsed.success) return false;
  try { storage.setItem(SAVED_SETTINGS_KEY, JSON.stringify(parsed.data)); return true; }
  catch { return false; }
}

export function readSavedLists(storage: Pick<Storage, "getItem">): SavedList[] {
  try {
    const raw = storage.getItem(SAVED_LISTS_KEY);
    if (!raw) return [];
    const parsed = z.array(savedListSchema).max(20).safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch { return []; }
}

export function writeSavedLists(storage: Pick<Storage, "setItem">, lists: SavedList[]): boolean {
  const parsed = z.array(savedListSchema).max(20).safeParse(lists);
  if (!parsed.success || new Set(lists.map((list) => list.id)).size !== lists.length) return false;
  try { storage.setItem(SAVED_LISTS_KEY, JSON.stringify(parsed.data)); return true; }
  catch { return false; }
}

export function createSavedList(
  id: string, name: string, basket: BasketItem[], settings: SavedSettings,
  savedAt = new Date().toISOString(),
): SavedList | null {
  const parsed = savedListSchema.safeParse({ id, name: name.trim(), basket, ...settings, savedAt });
  return parsed.success ? parsed.data : null;
}
