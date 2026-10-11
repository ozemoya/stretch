import { fuelCostCents } from "./live-trip";
import { bestRoadRoute, type RoadMatrix } from "./mix-match-optimizer";
import { cartGroups, cartSubtotal, validCartLine, type CartLine } from "./smart-cart";

export type GroceryTripOption = {
  lines: CartLine[];
  order: string[];
  groceryCents: number;
  fuelCents: number | null;
  gasPurchaseCents: number;
  totalCents: number | null;
  miles: number;
  minutes: number;
};

function combinations<T>(values: T[], count: number): T[][] {
  if (count === 0) return [[]];
  return values.flatMap((value, index) => combinations(values.slice(index + 1), count - 1)
    .map((rest) => [value, ...rest]));
}

/** Compare only verified alternatives for the exact requested cart items and physical branches. */
export function compareGroceryTrips(selected: CartLine[], alternatives: CartLine[], matrix: RoadMatrix,
  mpg: number, gasPrice: number, maxStores = 3, gasPurchaseCents = 0,
  minExtraStopSavingsCents = 0) {
  const active = selected.filter((line) => line.selected && validCartLine(line));
  if (!active.length || new Set(active.map((line) => line.item.id)).size !== active.length ||
    !Number.isFinite(mpg) || mpg <= 0 || maxStores < 1) {
    return { cheapest: null, fastest: null };
  }
  const candidates = active.map((line) => {
    const matches = [line, ...alternatives].filter((option) =>
      validCartLine(option) && matrix.storeIds.includes(option.store.id) &&
      option.item.id === line.item.id && option.item.name === line.item.name &&
      option.item.unit === line.item.unit);
    const unique = new Map(matches.map((option) => [option.id, option]));
    return [...unique.values()];
  });
  if (candidates.some((options) => !options.length)) return { cheapest: null, fastest: null };
  const availableIds = [...new Set(candidates.flat().map((option) => option.store.id))];
  const plans: GroceryTripOption[] = [];
  const seen = new Set<string>();
  for (let count = 1; count <= Math.min(maxStores, 3, availableIds.length); count++) {
    for (const subset of combinations(availableIds, count)) {
      const allowed = new Set(subset);
      const lines = candidates.map((options, index) => {
        const choice = options.filter((option) => allowed.has(option.store.id))
          .sort((a, b) => a.product.regularCents - b.product.regularCents || a.id.localeCompare(b.id))[0];
        return choice ? { ...choice, quantity: active[index].quantity, selected: true } : null;
      });
      if (lines.some((line) => !line)) continue;
      const complete = lines as CartLine[];
      const ids = cartGroups(complete).map((group) => group.store.id);
      const key = complete.map((line) => line.id).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const groceryCents = cartSubtotal(complete);
      for (const mode of ["distance", "duration"] as const) {
        const route = bestRoadRoute(ids, matrix, mode);
        if (!route) continue;
        const fuelCents = fuelCostCents(route.miles, mpg, gasPrice);
        plans.push({ lines: complete, order: route.order, groceryCents, fuelCents, gasPurchaseCents,
          totalCents: fuelCents === null ? null : groceryCents + fuelCents + gasPurchaseCents,
          miles: route.miles, minutes: route.minutes });
      }
    }
  }
  const baseline = plans.filter((plan) => plan.lines.every((line) => line.store.id === plan.lines[0].store.id) &&
    plan.totalCents !== null).sort((a, b) => a.totalCents! - b.totalCents!)[0];
  const eligible = plans.filter((plan) => {
    const stopCount = new Set(plan.lines.map((line) => line.store.id)).size;
    return !baseline || stopCount === 1 || plan.totalCents !== null &&
      baseline.totalCents! - plan.totalCents >= Math.max(0, minExtraStopSavingsCents) * (stopCount - 1);
  });
  const cheapest = eligible.filter((plan) => plan.totalCents !== null)
    .sort((a, b) => a.totalCents! - b.totalCents! || a.minutes - b.minutes)[0] ?? null;
  const fastest = [...eligible].sort((a, b) => a.minutes - b.minutes ||
    (a.totalCents ?? Infinity) - (b.totalCents ?? Infinity))[0] ?? null;
  return { cheapest, fastest };
}
