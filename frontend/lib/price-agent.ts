import { packageMatches } from "./package-match";
import type { SearchStatus } from "./search-state";

export type AgentItem = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
};
export type Candidate = {
  id: string;
  name: string;
  brand: string;
  size: string;
  soldBy: string;
  regularCents: number | null;
  retrievedAt: string;
  retailerId: string;
  storeLocationId: string;
  productId: string;
  productName: string;
  price: number | null;
  priceSource: string;
  verifiedAt: string;
  productUrl: string | null;
  imageUrl?: string;
  imageSourceUrl?: string;
  sourceStoreId?: string;
  priceKind?: "branch_advertised" | "branch_catalog";
  matchKind?: "exact" | "comparable" | "uncertain";
  upc?: string;
};
export type StoreCheck = {
  id: string;
  /** Native retailer branch ID, independent of the mapped OSM ID. */
  sourceLocationId?: string;
  coordinates?: { lat: number; lon: number };
  retailerId: string;
  name: string;
  address: string;
  requestedItemIds: string[];
  lines: {
    item: AgentItem;
    candidates: Candidate[];
    error?: string;
    searchStatus?: SearchStatus;
  }[];
};
export function ownedCandidate(
  store: Pick<StoreCheck, "id" | "retailerId">,
  product: Candidate,
) {
  return (
    product.retailerId === store.retailerId &&
    product.storeLocationId === store.id &&
    Number.isFinite(Date.parse(product.verifiedAt)) &&
    product.price !== null &&
    Number.isFinite(product.price) &&
    product.price > 0 &&
    product.regularCents !== null &&
    product.regularCents === Math.round(product.price * 100)
  );
}
export async function checkStores(
  items: AgentItem[],
  stores: { id: string; retailerId: string; name: string; address: string }[],
  search: (
    store: string,
    term: string,
    signal?: AbortSignal,
  ) => Promise<Candidate[]>,
  signal?: AbortSignal,
) {
  // Two branches run independently; requests stay sequential within each branch to respect API quotas.
  return Promise.all(
    stores.slice(0, 2).map(async (store): Promise<StoreCheck> => {
      const lines: StoreCheck["lines"] = [];
      for (const item of items) {
        signal?.throwIfAborted();
        try {
          const candidates = (await search(store.id, item.name, signal)).filter(
            (candidate) =>
              candidate.retailerId === store.retailerId &&
              candidate.storeLocationId === store.id,
          );
          lines.push({
            item,
            candidates,
            searchStatus: candidates.some((candidate) =>
              ownedCandidate(store, candidate),
            )
              ? "completed"
              : candidates.length
                ? "price_unavailable"
                : "no_results",
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          const timeout =
            error instanceof Error && /timeout|timed out/i.test(error.message);
          lines.push({
            item,
            candidates: [],
            error: timeout
              ? "Timed out. Retry this item."
              : "Price check failed. Try again later.",
            searchStatus: timeout ? "timeout" : "error",
          });
        }
      }
      return {
        ...store,
        requestedItemIds: items.map((item) => item.id),
        lines,
      };
    }),
  );
}
export function pricedItemCount(store: StoreCheck) {
  return store.requestedItemIds.filter((id) => {
    const line = store.lines.find((row) => row.item.id === id);
    return line?.candidates.some(
      (candidate) =>
        ownedCandidate(store, candidate) &&
        packageMatches(line.item.unit, candidate.size),
    );
  }).length;
}
export function reviewedTotal(
  store: StoreCheck,
  selected: Record<string, string>,
) {
  if (
    store.lines.length !== store.requestedItemIds.length ||
    new Set(store.lines.map((line) => line.item.id)).size !==
      store.requestedItemIds.length ||
    store.requestedItemIds.some(
      (id) => !store.lines.some((line) => line.item.id === id),
    )
  )
    return null;
  let cents = 0;
  for (const line of store.lines) {
    const product = line.candidates.find(
      (p) => p.id === selected[line.item.id],
    );
    if (
      !product ||
      !ownedCandidate(store, product) ||
      product.soldBy !== "UNIT" ||
      !packageMatches(line.item.unit, product.size)
    )
      return null;
    cents += product.regularCents! * line.item.quantity;
  }
  return cents;
}
