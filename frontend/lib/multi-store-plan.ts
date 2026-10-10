import { packageMatches } from "./package-match";
import { ownedCandidate, type AgentItem, type Candidate, type StoreCheck } from "./price-agent";

export type MultiStoreChoice = { storeId: string; candidateId: string };
export type MultiStoreSelections = Record<string, MultiStoreChoice>;
export type MultiStoreGroup = { store: StoreCheck; products: { item: AgentItem; product: Candidate }[]; subtotalCents: number };

export function eligibleMultiStoreOptions(item: AgentItem, stores: StoreCheck[]) {
  return stores.flatMap((store) => {
    const line = store.lines.find((row) => row.item.id === item.id);
    return (line?.candidates ?? [])
      .filter((product) => ownedCandidate(store, product) && product.soldBy === "UNIT" && packageMatches(item.unit, product.size))
      .map((product) => ({ store, product }));
  });
}

export function buildMultiStorePlan(items: AgentItem[], stores: StoreCheck[], selections: MultiStoreSelections, maxStores = 2) {
  if (!items.length || maxStores < 2) return null;
  const groups = new Map<string, MultiStoreGroup>();
  for (const item of items) {
    const choice = selections[item.id];
    if (!choice) return null;
    const match = eligibleMultiStoreOptions(item, stores).find(({ store, product }) =>
      store.id === choice.storeId && product.id === choice.candidateId);
    if (!match) return null;
    const group = groups.get(match.store.id) ?? { store: match.store, products: [], subtotalCents: 0 };
    group.products.push({ item, product: match.product });
    group.subtotalCents += match.product.regularCents! * item.quantity;
    groups.set(match.store.id, group);
    if (groups.size > maxStores) return null;
  }
  if (groups.size < 2) return null;
  const lists = [...groups.values()];
  return { lists, groceryCents: lists.reduce((sum, list) => sum + list.subtotalCents, 0) };
}
