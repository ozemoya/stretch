import { z } from "zod";
import type { BasketItem, Preferences } from "./types";
import type { AgentItem } from "./price-agent";
import type { SearchOrigin } from "./locations";
import type { GasStop } from "./gas-stop";
import type { FuelQuote } from "./live-data";

export const CHECKOUT_DRAFT_KEY = "stretch.checkout.v1";

const originSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
  label: z.string().min(1),
  zip: z.string().optional(),
});
const gasStopSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  lat: z.number().finite(),
  lon: z.number().finite(),
  mapUrl: z.url().startsWith("https://"),
});
const fuelQuoteSchema = z.object({
  kind: z.enum(["station", "regional"]).optional(),
  stationName: z.string().optional(),
  dollarsPerGallon: z.number().finite(),
  period: z.string(),
  retrievedAt: z.string(),
  sourceUrl: z.string(),
  region: z.string(),
});
const draftSchema = z.object({
  version: z.literal(1),
  basket: z.array(
    z.object({
      productId: z.string(),
      quantity: z.number().int().min(1).max(99),
    }),
  ),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      unit: z.string(),
      quantity: z.number().int().min(1).max(99),
    }),
  ),
  prefs: z.object({
    area: z.enum(["downtown", "midtown", "decatur"]),
    budget: z.number().finite().nonnegative(),
    mpg: z.number().finite().positive(),
    gas: z.number().finite().nonnegative(),
    maxStops: z.number().int().min(1).max(3),
    minExtraStopSavings: z.number().finite().min(0).max(1000).default(5),
    shoppingPriority: z.enum(["balanced", "lowest_cost", "fewest_stops"]).default("balanced"),
    vegan: z.boolean(),
    glutenFree: z.boolean(),
    nutFree: z.boolean(),
  }),
  origin: originSchema.nullable(),
  ipArea: z.boolean(),
  gasStop: gasStopSchema.nullable(),
  fuelSource: fuelQuoteSchema.nullable(),
  manualGas: z.number().finite().nonnegative(),
});

export type CheckoutDraft = {
  version: 1;
  basket: BasketItem[];
  items: AgentItem[];
  prefs: Preferences;
  origin: SearchOrigin | null;
  ipArea: boolean;
  gasStop: GasStop | null;
  fuelSource: FuelQuote | null;
  manualGas: number;
};

export function parseCheckoutDraft(value: unknown): CheckoutDraft | null {
  const result = draftSchema.safeParse(value);
  if (!result.success) return null;
  const draft = result.data;
  if (
    draft.items.length !== draft.basket.length ||
    draft.items.some(
      (item, index) =>
        item.id !== draft.basket[index].productId ||
        item.quantity !== draft.basket[index].quantity,
    )
  )
    return null;
  return draft;
}

export function readCheckoutDraft(
  storage: Pick<Storage, "getItem">,
): CheckoutDraft | null {
  try {
    const raw = storage.getItem(CHECKOUT_DRAFT_KEY);
    return raw ? parseCheckoutDraft(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeCheckoutDraft(
  storage: Pick<Storage, "setItem">,
  value: CheckoutDraft,
): boolean {
  const draft = parseCheckoutDraft(value);
  if (!draft) return false;
  try {
    storage.setItem(CHECKOUT_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
