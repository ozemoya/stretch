import { z } from "zod";
import type { CheckoutDraft } from "./checkout-draft";
import type { StoreCheck } from "./price-agent";
import { ownedCandidate, reviewedTotal } from "./price-agent";
import { fuelCostCents } from "./live-trip";
import { knownRetailerForUrl } from "./product-ownership";

export const TRIP_REVIEW_KEY = "stretch.trip-review.v1";

const productSchema = z.object({
  itemId: z.string().min(1), requestedName: z.string().min(1), quantity: z.number().int().positive(),
  retailerId: z.string().min(1), storeLocationId: z.string().min(1), productId: z.string().min(1),
  productName: z.string().min(1), packageSize: z.string().min(1), unitPriceCents: z.number().int().positive(),
  lineTotalCents: z.number().int().positive(), productUrl: z.string().url().nullable(),
  priceSource: z.string().min(1), verifiedAt: z.string().min(1),
});
const reviewSchema = z.object({
  version: z.literal(1), draftKey: z.string(), createdAt: z.string(),
  retailerId: z.string().min(1), storeLocationId: z.string().min(1), storeName: z.string().min(1),
  storeAddress: z.string(), storeMapUrl: z.string().url(),
  storeLat: z.number().finite().min(-90).max(90), storeLon: z.number().finite().min(-180).max(180),
  products: z.array(productSchema).min(1),
  gasStopId: z.string().min(1), gasPrice: z.number().finite().positive(),
  gasPriceReported: z.boolean(), mpg: z.number().finite().positive(),
  miles: z.number().finite().nonnegative(), minutes: z.number().finite().nonnegative(),
  groceryCents: z.number().int().nonnegative(), fuelCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),
});
export type TripReview = z.infer<typeof reviewSchema>;

export function tripDraftKey(draft: CheckoutDraft) {
  return JSON.stringify({ items: draft.items, origin: draft.origin, prefs: draft.prefs,
    gasStop: draft.gasStop, fuelSource: draft.fuelSource });
}

export function createTripReview(
  draft: CheckoutDraft, store: StoreCheck, selected: Record<string, string>,
  route: { miles: number; minutes: number }, storeLocation: { mapUrl: string; lat: number; lon: number },
): TripReview | null {
  if (!draft.gasStop || !draft.items.length || store.lines.length !== draft.items.length ||
      store.requestedItemIds.length !== draft.items.length ||
      draft.items.some((item) => !store.requestedItemIds.includes(item.id))) return null;
  const groceryCents = reviewedTotal(store, selected);
  const fuelCents = fuelCostCents(route.miles, draft.prefs.mpg, draft.prefs.gas);
  if (groceryCents === null || fuelCents === null || !Number.isFinite(route.minutes)) return null;
  const products = draft.items.map((item) => {
    const line = store.lines.find((row) => row.item.id === item.id && row.item.quantity === item.quantity);
    const product = line?.candidates.find((candidate) => candidate.id === selected[item.id]);
    if (!product || !ownedCandidate(store, product) ||
        (product.productUrl && knownRetailerForUrl(product.productUrl) && knownRetailerForUrl(product.productUrl) !== store.retailerId) ||
        (product.productUrl && !/^https:\/\//i.test(product.productUrl)) || !product.regularCents) return null;
    return { itemId: item.id, requestedName: item.name, quantity: item.quantity,
      retailerId: product.retailerId, storeLocationId: product.storeLocationId,
      productId: product.productId, productName: product.productName, packageSize: product.size,
      unitPriceCents: product.regularCents, lineTotalCents: product.regularCents * item.quantity,
      productUrl: product.productUrl, priceSource: product.priceSource, verifiedAt: product.verifiedAt };
  });
  if (products.some((product) => !product)) return null;
  return parseTripReview({ version: 1, draftKey: tripDraftKey(draft), createdAt: new Date().toISOString(),
    retailerId: store.retailerId, storeLocationId: store.id, storeName: store.name,
    storeAddress: store.address, storeMapUrl: storeLocation.mapUrl,
    storeLat: storeLocation.lat, storeLon: storeLocation.lon,
    products, gasStopId: draft.gasStop.id,
    gasPrice: draft.prefs.gas, gasPriceReported: !!draft.fuelSource,
    mpg: draft.prefs.mpg, miles: route.miles, minutes: route.minutes,
    groceryCents, fuelCents, totalCents: groceryCents + fuelCents });
}

export function parseTripReview(value: unknown, draft?: CheckoutDraft): TripReview | null {
  const parsed = reviewSchema.safeParse(value);
  if (!parsed.success) return null;
  const review = parsed.data;
  if (draft && (review.draftKey !== tripDraftKey(draft) ||
      review.products.length !== draft.items.length ||
      draft.items.some((item) => !review.products.some((product) =>
        product.itemId === item.id && product.quantity === item.quantity)))) return null;
  if (review.products.some((product) => product.retailerId !== review.retailerId ||
      product.storeLocationId !== review.storeLocationId ||
      (product.productUrl && knownRetailerForUrl(product.productUrl) && knownRetailerForUrl(product.productUrl) !== review.retailerId) ||
      (product.productUrl && !/^https:\/\//i.test(product.productUrl)) ||
      product.lineTotalCents !== product.unitPriceCents * product.quantity ||
      !Number.isFinite(Date.parse(product.verifiedAt))) ||
      new Set(review.products.map((product) => product.itemId)).size !== review.products.length ||
      review.products.reduce((sum, product) => sum + product.lineTotalCents, 0) !== review.groceryCents ||
      fuelCostCents(review.miles, review.mpg, review.gasPrice) !== review.fuelCents ||
      review.groceryCents + review.fuelCents !== review.totalCents ||
      !/^https:\/\//i.test(review.storeMapUrl) ||
      !Number.isFinite(Date.parse(review.createdAt))) return null;
  return review;
}

export function readTripReview(storage: Pick<Storage, "getItem">, draft: CheckoutDraft): TripReview | null {
  try { const raw = storage.getItem(TRIP_REVIEW_KEY); return raw ? parseTripReview(JSON.parse(raw), draft) : null; }
  catch { return null; }
}
export function writeTripReview(storage: Pick<Storage, "setItem">, review: TripReview): boolean {
  if (!parseTripReview(review)) return false;
  try { storage.setItem(TRIP_REVIEW_KEY, JSON.stringify(review)); return true; }
  catch { return false; }
}
