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
export function optimize(
  catalog: Catalog,
  basket: BasketItem[],
  p: Preferences,
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
  const distances = areas[p.area],
    trips: Trip[] = [];
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
    const miles =
      selected.length === 1
        ? 2 * distances[selected[0]]
        : distances[selected[0]] +
          between[selected[0]][selected[1]] +
          distances[selected[1]];
    const foodCents = stops.reduce(
      (sum, s) =>
        sum + s.items.reduce((a, i) => a + i.priceCents * i.quantity, 0),
      0,
    );
    const fuelCents = Math.round((miles / p.mpg) * p.gas * 100);
    trips.push({
      id: stops.map((x) => x.store.id).join("-"),
      stops,
      missing,
      foodCents,
      fuelCents,
      totalCents: foodCents + fuelCents,
      miles,
      minutes: Math.round((miles / 25) * 60) + stops.length * 12,
    });
  }
  return trips.sort(
    (a, b) =>
      Number(!!a.missing.length) - Number(!!b.missing.length) ||
      a.totalCents - b.totalCents ||
      a.stops.length - b.stops.length,
  );
}
export function suggestSwaps(
  catalog: Catalog,
  basket: BasketItem[],
  p: Preferences,
) {
  const baseline = optimize(catalog, basket, p);
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
    const candidates = optimize(catalog, updated, p);
    const after =
      candidates.find((t) => !t.missing.length) ??
      candidates.sort((a, b) => a.missing.length - b.missing.length)[0];
    if (!after || (!best && after.missing.length >= conflicts)) return [];
    const savings = best ? best.totalCents - after.totalCents : null;
    if (savings !== null && savings <= 0) return [];
    return [{ ...s, savings, updated, after, product }];
  });
}
