"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentItem, StoreCheck } from "@/lib/price-agent";
import type { SearchOrigin } from "@/lib/locations";
import { centers } from "@/lib/locations";
import type { StoreCoverage } from "@/lib/retailer-coverage";
import type { GasStop } from "@/lib/gas-stop";
import { fuelCostCents } from "@/lib/live-trip";
import { buildMultiStorePlan, eligibleMultiStoreOptions, type MultiStoreSelections } from "@/lib/multi-store-plan";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function MultiStorePlanner({ items, stores, locations, origin, area, gasStop, mpg, gasPrice, maxStores }: {
  items: AgentItem[]; stores: StoreCheck[]; locations: StoreCoverage[]; origin: SearchOrigin | null;
  area: "downtown" | "midtown" | "decatur"; gasStop: GasStop | null | undefined;
  mpg: number; gasPrice: number; maxStores: number;
}) {
  const [enabled, setEnabled] = useState(false);
  const [selections, setSelections] = useState<MultiStoreSelections>({});
  const [route, setRoute] = useState<{ key: string; miles: number; minutes: number; orderedIds: string[] } | null>(null);
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "unavailable">("idle");
  const [copied, setCopied] = useState("");
  const plan = useMemo(() => buildMultiStorePlan(items, stores, selections, maxStores), [items, stores, selections, maxStores]);
  const home = origin ?? centers[area];
  const selectedLocations = plan?.lists.map((list) => locations.find((location) => location.id === list.store.id));
  const routeKey = JSON.stringify([home.lat, home.lon, gasStop?.id, selectedLocations?.map((location) => location?.id)]);

  useEffect(() => {
    setRoute(null);
    if (!enabled || !plan || !gasStop || selectedLocations?.some((location) => !location)) {
      setRouteStatus("idle");
      return;
    }
    const controller = new AbortController();
    setRouteStatus("loading");
    const locationsForRoute = selectedLocations as StoreCoverage[];
    const orders = [locationsForRoute, [...locationsForRoute].reverse()];
    void Promise.all(orders.map(async (order) => {
      try {
        const response = await fetch("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: [home, ...order, gasStop, home].map(({ lat, lon }) => ({ lat, lon })) }), signal: controller.signal });
        if (!response.ok) return null;
        const result: { miles?: number; minutes?: number } = await response.json();
        return Number.isFinite(result.miles) && Number.isFinite(result.minutes)
          ? { miles: result.miles!, minutes: result.minutes!, orderedIds: order.map((location) => location.id) } : null;
      } catch { return null; }
    })).then((routes) => {
      if (controller.signal.aborted) return;
      const best = routes.filter((value): value is NonNullable<typeof value> => value !== null)
        .sort((a, b) => a.miles - b.miles)[0];
      setRoute(best ? { ...best, key: routeKey } : null);
      setRouteStatus(best ? "idle" : "unavailable");
    });
    return () => controller.abort();
  }, [enabled, routeKey, plan, gasStop, home.lat, home.lon]);

  const activeRoute = route?.key === routeKey ? route : null;
  const fuelCents = activeRoute ? fuelCostCents(activeRoute.miles, mpg, gasPrice) : null;
  const directionsUrl = activeRoute && gasStop ? (() => {
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", `${home.lat},${home.lon}`);
    url.searchParams.set("destination", `${home.lat},${home.lon}`);
    url.searchParams.set("waypoints", [...activeRoute.orderedIds.map((id) => {
      const location = locations.find((entry) => entry.id === id)!;
      return `${location.lat},${location.lon}`;
    }), `${gasStop.lat},${gasStop.lon}`].join("|"));
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  })() : null;

  async function copyList(name: string, products: NonNullable<typeof plan>["lists"][number]["products"]) {
    try {
      await navigator.clipboard.writeText([name, ...products.map(({ item, product }) =>
        `${item.quantity} × ${product.productName} (${product.size})${product.productUrl ? ` — ${product.productUrl}` : ""}`)].join("\n"));
      setCopied(`Copied ${name} list.`);
    } catch { setCopied(`Could not copy ${name}. You can use the list shown here.`); }
  }

  return <section className="multi-store-planner" aria-label="Mix and match stores">
    <label className="multi-store-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      <span><strong>Mix items from two stores</strong><small>Make a separate shopping list for each stop and check whether the extra drive pays off.</small></span></label>
    {enabled && <div className="multi-store-content">
      {maxStores < 2 ? <p>Change “Maximum stops” to two in your list settings to compare two stores.</p> : <>
        <p>Choose a verified item for every food. Prices stay with the store that supplied them.</p>
        <div className="multi-store-items">{items.map((item) => {
          const options = eligibleMultiStoreOptions(item, stores);
          const value = selections[item.id];
          return <label key={item.id}><span>{item.quantity} × {item.name}</span>
            <select aria-label={`Store and product for ${item.name}`} value={value ? JSON.stringify(value) : ""}
              onChange={(event) => setSelections((current) => ({ ...current, [item.id]: event.target.value ? JSON.parse(event.target.value) : undefined }))}>
              <option value="">Choose a store and package</option>
              {options.map(({ store, product }) => <option key={`${store.id}-${product.id}`} value={JSON.stringify({ storeId: store.id, candidateId: product.id })}>
                {store.name} · {product.productName} · {product.size} · {money(product.regularCents!)}
              </option>)}
            </select>
            {!options.length && <small>No verified store price for this item yet.</small>}
          </label>;
        })}</div>
        {!plan && <p className="small">Choose one priced product for each food from two different stores to build separate lists.</p>}
        {plan && <>
          <div className="multi-store-lists">{plan.lists.map((list) => <article key={list.store.id}>
            <h4>{list.store.name}</h4><p>{list.store.address}</p>
            <ul>{list.products.map(({ item, product }) => <li key={item.id}><span>{item.quantity} × {product.productName} <small>{product.size} · {product.priceSource} · {new Date(product.verifiedAt).toLocaleString()}</small></span><b>{money(product.regularCents! * item.quantity)}</b>{product.productUrl && <a href={product.productUrl} target="_blank" rel="noreferrer">Product ↗</a>}</li>)}</ul>
            <strong>List subtotal: {money(list.subtotalCents)}</strong>
            <button type="button" onClick={() => void copyList(list.store.name, list.products)}>Copy this store’s list</button>
          </article>)}</div>
          {copied && <p role="status">{copied}</p>}
          <div className="multi-store-total"><strong>Groceries: {money(plan.groceryCents)}</strong>
            {routeStatus === "loading" && <span role="status">Checking the two-stop drive…</span>}
            {routeStatus === "unavailable" && <span>Route unavailable; no trip total yet.</span>}
            {!gasStop && <span>Choose a gas station on the map for a trip total.</span>}
            {activeRoute && fuelCents !== null && <><span>Driving: {money(fuelCents)} · {activeRoute.miles.toFixed(1)} miles · about {activeRoute.minutes} minutes</span><b>Estimated trip: {money(plan.groceryCents + fuelCents)}</b></>}
          </div>
          {directionsUrl && <a className="multi-store-directions" href={directionsUrl} target="_blank" rel="noreferrer">Open two-store directions ↗</a>}
          <p className="small">These are separate shopping lists. Open each product link to shop; carts are not transferred between retailers. Taxes, stock, and final checkout prices can change.</p>
        </>}
      </>}
    </div>}
  </section>;
}
