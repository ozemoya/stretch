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
};
export type StoreCheck = {
  id: string;
  name: string;
  address: string;
  lines: { item: AgentItem; candidates: Candidate[]; error?: string }[];
};
export async function checkStores(
  items: AgentItem[],
  stores: { id: string; name: string; address: string }[],
  search: (store: string, term: string) => Promise<Candidate[]>,
) {
  const results: StoreCheck[] = [];
  // Keep provider requests bounded. A failed search must never become a zero-price item.
  for (const store of stores.slice(0, 2)) {
    const lines: StoreCheck["lines"] = [];
    for (const item of items) {
      try {
        lines.push({ item, candidates: await search(store.id, item.name) });
      } catch {
        lines.push({
          item,
          candidates: [],
          error: "Price check failed. Try again later.",
        });
      }
    }
    results.push({ ...store, lines });
  }
  return results;
}
export function reviewedTotal(
  store: StoreCheck,
  selected: Record<string, string>,
) {
  let cents = 0;
  for (const line of store.lines) {
    const product = line.candidates.find(
      (p) => p.id === selected[line.item.id],
    );
    if (!product || !product.regularCents || product.soldBy !== "UNIT")
      return null;
    cents += product.regularCents * line.item.quantity;
  }
  return cents;
}
