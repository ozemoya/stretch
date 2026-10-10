import type { BasketItem, Catalog, Preferences, Trip } from "./types";
export const areas = {
  downtown: [3, 7, 4],
  midtown: [6, 3, 5],
  decatur: [8, 5, 2],
};
const between = [
  [0, 5, 3],
  [5, 0, 6],
  [3, 6, 0],
];

function getRoute(
  selected: number[],
  catalog: Catalog,
  area: Preferences["area"],
  routes?: RouteMeasurements,
  requireMeasuredRoute = false,
) {
  const fallbackDistances = areas[area];
  const orders = selected.length < 2 ? [selected] : selected.flatMap((first) =>
    permutations(selected.filter((index) => index !== first)).map((rest) => [first, ...rest]));
  const fallback = orders.map((order) => {
    const miles = fallbackDistances[order[0]] + fallbackDistances[order.at(-1)!] +
      order.slice(1).reduce((sum, index, position) => sum + between[order[position]][index], 0);
    return { miles, minutes: Math.round((miles / 25) * 60), order };
  }).sort((a, b) => a.miles - b.miles || a.minutes - b.minutes)[0];

  if (!routes) return requireMeasuredRoute ? null : fallback;

  const candidates = orders.flatMap((order) => {
    const key = order.map((i) => catalog.stores[i].id).join("|");

    const route = routes[key];

    if (
      !route ||
      !Number.isFinite(route.miles) ||
      route.miles < 0 ||
      !Number.isFinite(route.minutes) ||
      route.minutes < 0
    ) {
      return [];
    }

    return [{ ...route, order }];
  });

  return (
    candidates.sort((a, b) => a.miles - b.miles || a.minutes - b.minutes)[0] ??
    (requireMeasuredRoute ? null : fallback)
  );
}

function permutations(values: number[]): number[][] {
  if (!values.length) return [[]];
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index))
    .map((rest) => [value, ...rest]));
}

export function optimize(
  catalog: Catalog,
  basket: BasketItem[],
  p: Preferences,
  routes?: RouteMeasurements,
  requireMeasuredRoute = false,
): Trip[] {
  if (!basket.length) return [];
  if (
    !Number.isFinite(p.mpg) ||
    p.mpg <= 0 ||
    !Number.isFinite(p.gas) ||
    p.gas < 0 ||
    !Number.isFinite(p.budget) ||
    p.budget < 0
  )
    throw new Error(
      "Enter a positive MPG and nonnegative budget and gas price.",
    );
  const trips: Trip[] = [];
  for (let mask = 1; mask < 1 << catalog.stores.length; mask++) {
    const selected = catalog.stores
      .map((_, i) => i)
      .filter((i) => mask & (1 << i));
    if (selected.length > p.maxStops) continue;
    const stops = selected.map((i) => ({
      store: catalog.stores[i],
      items: [] as Trip["stops"][number]["items"],
    }));
    const missing: string[] = [];
    for (const item of basket) {
      const product = catalog.products.find((x) => x.id === item.productId);
      if (
        !product ||
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 99
      )
        throw new Error("Invalid basket item.");
      if (
        (p.vegan && !product.vegan) ||
        (p.glutenFree && !product.glutenFree) ||
        (p.nutFree && !product.nutFree)
      ) {
        missing.push(product.name + " (dietary preference)");
        continue;
      }
      const offers = catalog.offers
        .filter(
          (x) =>
            x.productId === item.productId &&
            x.available &&
            stops.some((s) => s.store.id === x.storeId),
        )
        .sort(
          (a, b) =>
            a.priceCents - b.priceCents || a.storeId.localeCompare(b.storeId),
        );
      const best = offers[0];
      if (!best) {
        missing.push(product.name);
        continue;
      }
      stops
        .find((s) => s.store.id === best.storeId)!
        .items.push({
          ...product,
          productId: product.id,
          quantity: item.quantity,
          priceCents: best.priceCents,
          recordedAt: best.recordedAt,
          isSample: best.isSample,
        });
    }
    // Empty stops cannot improve a route. Keep incomplete single-store estimates visible.
    if (stops.some((x) => !x.items.length) && stops.length > 1) continue;
    const route = getRoute(
      selected,
      catalog,
      p.area,
      routes,
      requireMeasuredRoute,
    );
    if (!route) continue;

    const miles = route.miles;

    const foodCents = stops.reduce(
      (sum, s) =>
        sum + s.items.reduce((a, i) => a + i.priceCents * i.quantity, 0),
      0,
    );
    const fuelCents = Math.round((miles / p.mpg) * p.gas * 100);
    trips.push({
      id: stops.map((x) => x.store.id).join("-"),
      stops: route.order.map((i) =>
        stops.find((s) => s.store.id === catalog.stores[i].id)!,
      ),
      missing,
      foodCents,
      fuelCents,
      totalCents: foodCents + fuelCents,
      miles,
      minutes:
        route.minutes + stops.length * 12 + (requireMeasuredRoute ? 5 : 0),
    });
  }
  const complete = trips.filter((trip) => !trip.missing.length);
  const baseline = complete.filter((trip) => trip.stops.length === 1)
    .sort((a, b) => a.totalCents - b.totalCents)[0];
  const thresholdCents = Math.max(0, p.minExtraStopSavings) * 100;
  const bestTwo = complete.filter((trip) => trip.stops.length === 2 &&
    (!baseline || baseline.totalCents - trip.totalCents >= thresholdCents))
    .sort((a, b) => a.totalCents - b.totalCents)[0];
  const eligible = trips.filter((trip) => {
    if (trip.missing.length || trip.stops.length === 1 || !baseline) return true;
    if (baseline.totalCents - trip.totalCents < thresholdCents * (trip.stops.length - 1)) return false;
    if (trip.stops.length === 3 && bestTwo && bestTwo.totalCents - trip.totalCents < thresholdCents) return false;
    return true;
  });
  return eligible.sort((a, b) => {
    const completeness = Number(!!a.missing.length) - Number(!!b.missing.length);
    if (completeness) return completeness;
    if (p.shoppingPriority === "fewest_stops")
      return a.stops.length - b.stops.length || a.totalCents - b.totalCents;
    if (p.shoppingPriority === "balanced") {
      const score = (trip: Trip) => trip.totalCents + (trip.stops.length - 1) * 200 + trip.minutes * 5;
      return score(a) - score(b) || a.totalCents - b.totalCents;
    }
    return a.totalCents - b.totalCents || a.stops.length - b.stops.length;
  });
}

export function suggestSwaps(
  catalog: Catalog,
  basket: BasketItem[],
  p: Preferences,
  routes?: RouteMeasurements,
  requireMeasuredRoute = false,
) {
  const baseline = optimize(catalog, basket, p, routes, requireMeasuredRoute);
  const best = baseline.find((t) => !t.missing.length);
  const conflicts = Math.min(...baseline.map((t) => t.missing.length));
  return catalog.swaps.flatMap((s) => {
    const item = basket.find((x) => x.productId === s.fromId);
    if (!item) return [];
    const product = catalog.products.find((x) => x.id === s.toId)!;
    if (
      (p.vegan && !product.vegan) ||
      (p.glutenFree && !product.glutenFree) ||
      (p.nutFree && !product.nutFree)
    )
      return [];
    const updated = basket.filter(
      (x) => x.productId !== s.fromId && x.productId !== s.toId,
    );
    updated.push({
      productId: s.toId,
      quantity:
        item.quantity +
        (basket.find((x) => x.productId === s.toId)?.quantity ?? 0),
    });
    const candidates = optimize(
      catalog,
      updated,
      p,
      routes,
      requireMeasuredRoute,
    );
    const after =
      candidates.find((t) => !t.missing.length) ??
      candidates.sort((a, b) => a.missing.length - b.missing.length)[0];
    if (!after || (!best && after.missing.length >= conflicts)) return [];
    const savings = best ? best.totalCents - after.totalCents : null;
    if (savings !== null && savings <= 0) return [];
    return [{ ...s, savings, updated, after, product }];
  });
}

export type RouteMeasurement = {
  miles: number;
  minutes: number;
};

export type RouteMeasurements = Record<string, RouteMeasurement>;
