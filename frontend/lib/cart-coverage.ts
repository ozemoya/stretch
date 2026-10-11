import type { AgentItem } from "./price-agent";
import type { CartLine } from "./smart-cart";
import type { CatalogPick } from "./catalog-picks";

/** Only products explicitly selected for the current grocery list count toward checkout. */
export function missingCartItems(items: AgentItem[], lines: CartLine[], picks: CatalogPick[]): AgentItem[] {
  const selected = new Set<string>();
  for (const line of lines) if (line.selected) selected.add(line.item.id);
  for (const pick of picks) selected.add(pick.itemId);
  return items.filter((item) => !selected.has(item.id));
}
