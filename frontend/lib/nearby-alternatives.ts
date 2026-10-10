import {
  ownedCandidate,
  type AgentItem,
  type Candidate,
  type StoreCheck,
} from "./price-agent";
import { packageMatches } from "./package-match";

export type NearbyAlternative = {
  store: Pick<StoreCheck, "id" | "retailerId" | "name" | "address">;
  item: AgentItem;
  product: Candidate;
  savingsCents: number;
};

export function nearbyAlternatives(
  stores: StoreCheck[],
  choices: Record<string, Record<string, string>>,
) {
  const found = new Map<string, NearbyAlternative>();
  for (const source of stores) {
    for (const line of source.lines) {
      const selected = line.candidates.find(
        (candidate) =>
          candidate.id === choices[source.id]?.[line.item.id] &&
          ownedCandidate(source, candidate),
      );
      if (
        !selected?.regularCents ||
        !packageMatches(line.item.unit, selected.size)
      )
        continue;
      for (const other of stores) {
        if (other.id === source.id) continue;
        const otherLine = other.lines.find(
          (row) => row.item.id === line.item.id,
        );
        for (const candidate of otherLine?.candidates ?? []) {
          if (
            !ownedCandidate(other, candidate) ||
            !packageMatches(line.item.unit, candidate.size) ||
            !candidate.regularCents ||
            candidate.regularCents >= selected.regularCents
          )
            continue;
          const key = `${other.retailerId}:${other.id}:${candidate.upc || candidate.productId}`;
          const alternative = {
            store: other,
            item: line.item,
            product: candidate,
            savingsCents:
              (selected.regularCents - candidate.regularCents) *
              line.item.quantity,
          };
          if (
            !found.has(key) ||
            found.get(key)!.savingsCents < alternative.savingsCents
          )
            found.set(key, alternative);
        }
      }
    }
  }
  return [...found.values()].sort((a, b) => b.savingsCents - a.savingsCents);
}
