import { fuelCostCents } from "./live-trip";
import { eligibleMultiStoreOptions, type MultiStoreSelections } from "./multi-store-plan";
import type { AgentItem, Candidate, StoreCheck } from "./price-agent";

export type RoadMatrix = {
  storeIds: string[];
  distances: (number | null)[][]; // OSRM road metres, indexed home, stores, optional fuel stop
  durations: (number | null)[][]; // OSRM seconds in the same order
  hasFuelStop: boolean;
  provider?: "google" | "osrm";
};
export type MixMatchPlan = {
  selections: MultiStoreSelections;
  storeIds: string[];
  groceryCents: number;
  fuelCents: number;
  totalCents: number;
  miles: number;
  minutes: number;
  routeOrder: string[];
  gasStopIncluded: boolean;
  gasPurchaseCents: number;
};
export type MixMatchPriority = "balanced" | "lowest_cost" | "fewest_stops";
export type GasStopEconomics = { gallonsNeeded: number; baselinePrice: number; stationPrice: number };

function permutations<T>(values: T[]): T[][] {
  if (values.length < 2) return [values];
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index))
    .map((rest) => [value, ...rest]));
}

export function roadRouteForOrder(storeIds: string[], matrix: RoadMatrix) {
  if (!storeIds.length || new Set(storeIds).size !== storeIds.length ||
    storeIds.some((id) => !matrix.storeIds.includes(id))) return null;
  const fuelIndex = matrix.hasFuelStop ? matrix.storeIds.length + 1 : null;
  const stops = [0, ...storeIds.map((id) => matrix.storeIds.indexOf(id) + 1),
    ...(fuelIndex === null ? [] : [fuelIndex]), 0];
  let metres = 0;
  let seconds = 0;
  for (let i = 1; i < stops.length; i++) {
    const distance = matrix.distances[stops[i - 1]]?.[stops[i]];
    const duration = matrix.durations[stops[i - 1]]?.[stops[i]];
    if (distance === null || duration === null || !Number.isFinite(distance) || !Number.isFinite(duration)) {
      return null;
    }
    metres += distance!;
    seconds += duration!;
  }
  return { order: storeIds, miles: metres / 1609.344, minutes: seconds / 60 };
}

export function bestRoadRoute(storeIds: string[], matrix: RoadMatrix, mode: "distance" | "duration" = "distance") {
  if (!storeIds.length || storeIds.some((id) => !matrix.storeIds.includes(id))) return null;
  let best: { order: string[]; miles: number; minutes: number } | null = null;
  for (const order of permutations(storeIds)) {
    const route = roadRouteForOrder(order, matrix);
    if (!route) continue;
    const better = !best || (mode === "duration"
      ? route.minutes < best!.minutes || route.minutes === best!.minutes && route.miles < best!.miles
      : route.miles < best!.miles || route.miles === best!.miles && route.minutes < best!.minutes);
    if (better)
      best = route;
  }
  return best;
}

export function priceSelections(items: AgentItem[], stores: StoreCheck[], selections: MultiStoreSelections,
  matrix: RoadMatrix, mpg: number, gasPrice: number, maxStores: number,
  gasOption?: GasStopEconomics): MixMatchPlan | null {
  if (!items.length || maxStores < 1 || maxStores > 3) return null;
  const used = new Set<string>();
  let groceryCents = 0;
  for (const item of items) {
    const selected = selections[item.id];
    const option = selected && eligibleMultiStoreOptions(item, stores).find(({ store, product }) =>
      store.id === selected.storeId && product.id === selected.candidateId);
    if (!option) return null;
    used.add(option.store.id);
    groceryCents += option.product.regularCents! * item.quantity;
  }
  if (used.size > maxStores) return null;
  let route = bestRoadRoute([...used], matrix);
  if (!route) return null;
  let gasStopIncluded = matrix.hasFuelStop;
  let gasPurchaseCents = 0;
  if (matrix.hasFuelStop && gasOption && gasOption.gallonsNeeded > 0 &&
    gasOption.baselinePrice > 0 && gasOption.stationPrice > 0) {
    const withoutStop = bestRoadRoute([...used], { ...matrix, hasFuelStop: false });
    if (!withoutStop) return null;
    const noStopDriving = fuelCostCents(withoutStop.miles, mpg, gasOption.baselinePrice);
    const withStopDriving = fuelCostCents(route.miles, mpg, gasOption.stationPrice);
    if (noStopDriving === null || withStopDriving === null) return null;
    const noStopPurchase = Math.round(gasOption.gallonsNeeded * gasOption.baselinePrice * 100);
    const withStopPurchase = Math.round(gasOption.gallonsNeeded * gasOption.stationPrice * 100);
    if (withStopDriving + withStopPurchase >= noStopDriving + noStopPurchase) {
      route = withoutStop; gasStopIncluded = false; gasPurchaseCents = noStopPurchase;
    } else gasPurchaseCents = withStopPurchase;
  }
  const fuelCents = fuelCostCents(route.miles, mpg,
    gasOption && !gasStopIncluded ? gasOption.baselinePrice : gasPrice);
  if (fuelCents === null) return null;
  return { selections, storeIds: [...used], groceryCents, fuelCents,
    gasStopIncluded, gasPurchaseCents, totalCents: groceryCents + fuelCents + gasPurchaseCents,
    miles: route.miles, minutes: route.minutes, routeOrder: route.order };
}

function lowestPriced(item: AgentItem, stores: StoreCheck[]) {
  return eligibleMultiStoreOptions(item, stores)
    .sort((a, b) => a.product.regularCents! - b.product.regularCents! ||
      a.store.id.localeCompare(b.store.id) || a.product.id.localeCompare(b.product.id))[0];
}

function combinations<T>(values: T[], count: number): T[][] {
  if (count === 0) return [[]];
  return values.flatMap((value, index) => combinations(values.slice(index + 1), count - 1)
    .map((rest) => [value, ...rest]));
}

/** Exact over the supplied branch set (at most eight stores); prices and routes remain source-bound. */
export function optimizeMixMatch(items: AgentItem[], stores: StoreCheck[], matrix: RoadMatrix,
  prefs: { maxStores: number; minNetSavingsCents: number; priority: MixMatchPriority; mpg: number; gasPrice: number;
    gasOption?: GasStopEconomics }) {
  const candidates = stores.filter((store) => matrix.storeIds.includes(store.id));
  const unresolved = items.filter((item) => !eligibleMultiStoreOptions(item, candidates).length).map((item) => item.id);
  if (unresolved.length || !items.length) return { unresolved, baseline: null, cheapest: null, fewest: null,
    balanced: null, recommended: null, plans: [] as MixMatchPlan[] };
  const plans: MixMatchPlan[] = [];
  const seen = new Set<string>();
  for (let count = 1; count <= Math.min(3, prefs.maxStores, candidates.length); count++) {
    for (const subset of combinations(candidates, count)) {
      const selections: MultiStoreSelections = {};
      for (const item of items) {
        const option = lowestPriced(item, subset);
        if (!option) break;
        selections[item.id] = { storeId: option.store.id, candidateId: option.product.id };
      }
      if (Object.keys(selections).length !== items.length) continue;
      const plan = priceSelections(items, candidates, selections, matrix, prefs.mpg, prefs.gasPrice, prefs.maxStores, prefs.gasOption);
      if (!plan) continue;
      const key = [...plan.storeIds].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      plans.push(plan);
    }
  }
  const byCost = (a: MixMatchPlan, b: MixMatchPlan) => a.totalCents - b.totalCents ||
    a.storeIds.length - b.storeIds.length || a.minutes - b.minutes;
  plans.sort(byCost);
  const baseline = plans.filter((plan) => plan.storeIds.length === 1).sort(byCost)[0] ?? null;
  const threshold = Math.max(0, prefs.minNetSavingsCents);
  const eligible = plans.filter((plan) => {
    if (plan.storeIds.length === 1) return true;
    if (!baseline) return false; // Cannot verify the claimed savings without a complete single-store basket.
    if (baseline.totalCents - plan.totalCents < threshold * (plan.storeIds.length - 1)) return false;
    if (plan.storeIds.length === 3) {
      const two = plans.filter((candidate) => candidate.storeIds.length === 2 &&
        baseline.totalCents - candidate.totalCents >= threshold).sort(byCost)[0];
      if (two && two.totalCents - plan.totalCents < threshold) return false;
    }
    return true;
  });
  const cheapest = eligible[0] ?? null;
  const fewest = [...eligible].sort((a, b) => a.storeIds.length - b.storeIds.length || byCost(a, b))[0] ?? null;
  // Balanced gives a modest, explicit preference to fewer stops and shorter drives.
  const balanced = [...eligible].sort((a, b) =>
    (a.totalCents + (a.storeIds.length - 1) * 200 + a.minutes * 5) -
    (b.totalCents + (b.storeIds.length - 1) * 200 + b.minutes * 5) || byCost(a, b))[0] ?? null;
  const recommended = prefs.priority === "lowest_cost" ? cheapest :
    prefs.priority === "fewest_stops" ? fewest : balanced;
  return { unresolved, baseline, cheapest, fewest, balanced, recommended, plans };
}
