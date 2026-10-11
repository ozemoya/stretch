"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { AgentItem, Candidate, StoreCheck } from "@/lib/price-agent";
import { centers, type SearchOrigin } from "@/lib/locations";
import type { StoreCoverage } from "@/lib/retailer-coverage";
import type { GasStop } from "@/lib/gas-stop";
import { eligibleMultiStoreOptions, type MultiStoreSelections } from "@/lib/multi-store-plan";
import { optimizeMixMatch, priceSelections, type GasStopEconomics, type MixMatchPlan, type MixMatchPriority, type RoadMatrix } from "@/lib/mix-match-optimizer";
import { readCheckoutDraft, writeCheckoutDraft } from "@/lib/checkout-draft";
import { addCartLine, cartLine, readCart, readCartOptions, writeCart, writeCartOptions, SMART_CART_EVENT } from "@/lib/smart-cart";
import { readCatalogPicks, writeCatalogPicks } from "@/lib/catalog-picks";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function MultiStorePlanner({ items, stores, locations, origin, area, gasStop, mpg, gasPrice, gasEconomics,
  maxStores, minExtraStopSavings, shoppingPriority }: {
  items: AgentItem[]; stores: StoreCheck[]; locations: StoreCoverage[]; origin: SearchOrigin | null;
  area: "downtown" | "midtown" | "decatur"; gasStop: GasStop | null | undefined;
  mpg: number; gasPrice: number; gasEconomics?: GasStopEconomics;
  maxStores: number; minExtraStopSavings: number;
  shoppingPriority: MixMatchPriority;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(maxStores > 1);
  const [selections, setSelections] = useState<MultiStoreSelections>({});
  const [road, setRoad] = useState<{ key: string; matrix: RoadMatrix } | null>(null);
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "unavailable">("idle");
  const [copied, setCopied] = useState("");
  const [cartMessage, setCartMessage] = useState("");
  const home = origin ?? centers[area];
  const pricedStores = useMemo(() => stores.filter((store) => locations.some((location) => location.id === store.id))
    .sort((a, b) => {
      const coverage = (store: StoreCheck) => items.filter((item) => eligibleMultiStoreOptions(item, [store]).length).length;
      return coverage(b) - coverage(a) || a.id.localeCompare(b.id);
    }), [stores, locations, items]);
  // One OSRM road-distance table keeps the search bounded. Larger sets are marked approximate.
  const routeStores = useMemo(() => pricedStores.slice(0, 8), [pricedStores]);
  const routeLocations = routeStores.map((store) => locations.find((location) => location.id === store.id)!);
  const routeKey = JSON.stringify([home.lat, home.lon, gasStop?.id, gasStop?.lat, gasStop?.lon,
    routeLocations.map((location) => [location.id, location.lat, location.lon])]);
  const itemKey = JSON.stringify([items.map((item) => [item.id, item.quantity, item.unit]), routeStores.map((store) => store.id)]);

  useEffect(() => { setSelections({}); }, [itemKey]);
  useEffect(() => {
    setRoad(null);
    if (!enabled || !routeStores.length) { setRouteStatus("idle"); return; }
    const controller = new AbortController();
    setRouteStatus("loading");
    const points = [home, ...routeLocations, ...(gasStop ? [gasStop] : [])]
      .map(({ lat, lon }) => ({ lat, lon }));
    void fetch("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matrix: true, points }), signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Road routes unavailable");
        return response.json() as Promise<Pick<RoadMatrix, "distances" | "durations">>;
      }).then((result) => {
        if (controller.signal.aborted) return;
        setRoad({ key: routeKey, matrix: { storeIds: routeStores.map((store) => store.id),
          distances: result.distances, durations: result.durations, hasFuelStop: !!gasStop } });
        setRouteStatus("idle");
      }).catch(() => { if (!controller.signal.aborted) setRouteStatus("unavailable"); });
    return () => controller.abort();
  }, [enabled, routeKey]);

  const matrix = road?.key === routeKey ? road.matrix : null;
  // Without a usable station report, a selected pump cannot improve a price-based recommendation.
  const planningMatrix = useMemo(() => matrix && gasStop && !gasEconomics
    ? { ...matrix, hasFuelStop: false } : matrix, [matrix, gasStop, gasEconomics]);
  const optimization = useMemo(() => planningMatrix ? optimizeMixMatch(items, routeStores, planningMatrix, {
    maxStores, minNetSavingsCents: Math.round(minExtraStopSavings * 100),
    priority: shoppingPriority, mpg, gasPrice, gasOption: gasEconomics,
  }) : null, [planningMatrix, items, routeStores, maxStores, minExtraStopSavings, shoppingPriority, mpg, gasPrice, gasEconomics]);
  useEffect(() => {
    if (optimization?.recommended) setSelections((current) =>
      Object.keys(current).length ? current : optimization.recommended!.selections);
  }, [optimization?.recommended]);
  const selectedPlan = planningMatrix ? priceSelections(items, routeStores, selections, planningMatrix, mpg, gasPrice, maxStores, gasEconomics) : null;
  const plan = selectedPlan ?? (Object.keys(selections).length ? null : optimization?.recommended ?? null);
  const baseline = optimization?.baseline;
  const savings = plan && baseline ? baseline.totalCents - plan.totalCents : null;
  const requiredSavings = plan ? Math.round(minExtraStopSavings * 100) * (plan.storeIds.length - 1) : 0;
  const belowThreshold = plan && plan.storeIds.length > 1 && (savings === null || savings < requiredSavings);
  const directionsUrl = plan ? (() => {
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", `${home.lat},${home.lon}`);
    url.searchParams.set("destination", `${home.lat},${home.lon}`);
    url.searchParams.set("waypoints", [...plan.routeOrder.map((id) => {
      const location = locations.find((entry) => entry.id === id)!;
      return `${location.lat},${location.lon}`;
    }), ...(gasStop && plan.gasStopIncluded ? [`${gasStop.lat},${gasStop.lon}`] : [])].join("|"));
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  })() : null;

  async function copyList(name: string, products: { item: AgentItem; product: Candidate }[]) {
    try {
      await navigator.clipboard.writeText([name, ...products.map(({ item, product }) =>
        `${item.quantity} × ${product.productName} (${product.size})${product.productUrl ? ` — ${product.productUrl}` : ""}`)].join("\n"));
      setCopied(`Copied ${name} list.`);
    } catch { setCopied(`Could not copy ${name}. You can use the list shown here.`); }
  }
  function listFor(chosen: MixMatchPlan, storeId: string) {
    return items.flatMap((item) => {
      const choice = chosen.selections[item.id];
      if (choice?.storeId !== storeId) return [];
      const option = eligibleMultiStoreOptions(item, routeStores).find(({ store, product }) =>
        store.id === storeId && product.id === choice.candidateId);
      return option ? [{ item, product: option.product }] : [];
    });
  }

  function addSelectedItem(item: AgentItem) {
    const choice = selections[item.id];
    const option = choice && eligibleMultiStoreOptions(item, routeStores).find(({ store, product }) =>
      store.id === choice.storeId && product.id === choice.candidateId);
    const location = option && locations.find((entry) => entry.id === option.store.id);
    const line = option && location && cartLine(item, option.product, option.store, location);
    if (!line) { setCartMessage("Choose a verified product with its own store page first."); return; }
    saveOptions([item]);
    const next = addCartLine(readCart(localStorage), line);
    if (!writeCart(localStorage, next)) { setCartMessage("Could not save this item on this device."); return; }
    writeCatalogPicks(localStorage, readCatalogPicks(localStorage).filter((pick) => pick.itemId !== item.id));
    window.dispatchEvent(new Event(SMART_CART_EVENT));
    setCartMessage(`${item.name} added to your cart.`);
  }
  function saveOptions(selectedItems: AgentItem[]) {
    const itemIds = new Set(selectedItems.map((item) => item.id));
    const options = selectedItems.flatMap((item) => eligibleMultiStoreOptions(item, routeStores).flatMap(({ store, product }) => {
      const location = locations.find((entry) => entry.id === store.id);
      const line = location && cartLine(item, product, store, location);
      return line ? [line] : [];
    }));
    const previous = readCartOptions(localStorage).filter((line) => !itemIds.has(line.item.id));
    writeCartOptions(localStorage, [...previous, ...options].slice(0, 200));
  }
  function savePlan(chosen: MixMatchPlan) {
    const lines = chosen.routeOrder.flatMap((id) => listFor(chosen, id).flatMap(({ item, product }) => {
      const store = routeStores.find((entry) => entry.id === id);
      const location = locations.find((entry) => entry.id === id);
      const line = store && location && cartLine(item, product, store, location);
      return line ? [line] : [];
    }));
    if (lines.length !== items.length || !writeCart(localStorage, lines)) {
      setCartMessage("This trip could not be saved. Check each store and product match."); return;
    }
    saveOptions(items);
    if (gasStop && !chosen.gasStopIncluded) {
      const draft = readCheckoutDraft(sessionStorage);
      if (draft) writeCheckoutDraft(sessionStorage, { ...draft, gasStop: null, fuelSource: null,
        prefs: { ...draft.prefs, gas: draft.manualGas } });
    }
    const selectedIds = new Set(items.map((item) => item.id));
    writeCatalogPicks(localStorage, readCatalogPicks(localStorage).filter((pick) => !selectedIds.has(pick.itemId)));
    window.dispatchEvent(new Event(SMART_CART_EVENT));
    router.push("/cart");
  }

  return <section className="multi-store-planner" aria-label="Mix and match stores">
    <label className="multi-store-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
      <span><strong>Mix & Match</strong><small>Compare complete lists at up to {maxStores} stores, including the drive.</small></span></label>
    {enabled && <div className="multi-store-content">
      <p className="small">{shoppingPriority === "balanced" ? "Balanced" : shoppingPriority === "lowest_cost" ? "Lowest cost" : "Fewest stops"} priority · {money(Math.round(minExtraStopSavings * 100))} minimum net savings per extra stop. Change these in your saved trip preferences.</p>
      {pricedStores.length > 8 && <p className="small">Road optimization uses the eight nearby stores with the most priced items; this is a bounded comparison.</p>}
      {gasStop && !gasEconomics && <p className="small">The selected gas station has no recent reported price or fill-up amount, so Mix & Match does not recommend a detour to it.</p>}
      {routeStatus === "loading" && <p role="status">Checking road distances for the priced stores…</p>}
      {routeStatus === "unavailable" && <p role="status">Road routes are unavailable right now, so Stretch cannot quote a Mix & Match total.</p>}
      {optimization?.unresolved.length ? <p>Some foods have no matching branch price: {items.filter((item) => optimization.unresolved.includes(item.id)).map((item) => item.name).join(", ")}. No complete route can be recommended.</p> : null}
      {optimization && !optimization.unresolved.length && <>
        <div className="mix-strategies" role="group" aria-label="Shopping strategies">
          {([ ["Balanced", optimization.balanced], ["Cheapest overall", optimization.cheapest], ["Fewest stops", optimization.fewest] ] as const)
            .filter(([, choice]) => !!choice).map(([label, choice]) => <button key={label} type="button"
              onClick={() => setSelections(choice!.selections)}>
              <strong>{label}</strong><span>{money(choice!.totalCents)} · {choice!.storeIds.length} {choice!.storeIds.length === 1 ? "store" : "stores"}</span>
            </button>)}
        </div>
        {!baseline && <p className="small">No complete single-store basket exists, so extra-stop savings cannot be verified. You can still assign items manually.</p>}
        {baseline && optimization.plans.some((candidate) => candidate.storeIds.length > 1) &&
          !optimization.plans.some((candidate) => candidate.storeIds.length > 1 &&
            baseline.totalCents - candidate.totalCents >= Math.round(minExtraStopSavings * 100) * (candidate.storeIds.length - 1)) &&
          <p className="small">A second stop does not clear your {money(Math.round(minExtraStopSavings * 100))} net-savings minimum. One store is recommended.</p>}
      </>}
      <div className="multi-store-items">{items.map((item) => {
        const options = eligibleMultiStoreOptions(item, routeStores);
        const value = selections[item.id];
        return <label key={item.id}><span>{item.quantity} × {item.name}</span>
          <select aria-label={`Store and product for ${item.name}`} value={value ? JSON.stringify(value) : ""}
            onChange={(event) => setSelections((current) => {
              const next = { ...current };
              if (event.target.value) next[item.id] = JSON.parse(event.target.value);
              else delete next[item.id];
              return next;
            })}>
            <option value="">Choose a store and package</option>
            {options.map(({ store, product }) => <option key={`${store.id}-${product.id}`} value={JSON.stringify({ storeId: store.id, candidateId: product.id })}>
              {store.name} · {product.productName} · {product.size} · {money(product.regularCents!)}
            </option>)}
          </select>
          {value && <button type="button" onClick={() => addSelectedItem(item)}>Add to cart</button>}
          {!options.length && <small>No verified store price for this item yet.</small>}
        </label>;
      })}</div>
      {plan ? <>
        <div className="multi-store-lists">{plan.routeOrder.map((id, index) => {
          const store = routeStores.find((entry) => entry.id === id)!;
          const products = listFor(plan, id);
          return <article key={id}><h4>{index + 1}. {store.name}</h4><p>{store.address}</p>
            <ul>{products.map(({ item, product }) => <li key={item.id}><span>{item.quantity} × {product.productName}
              <small>{product.size} · {product.priceSource} · {new Date(product.verifiedAt).toLocaleString()}</small></span>
              <b>{money(product.regularCents! * item.quantity)}</b>
              {product.productUrl && <a href={product.productUrl} target="_blank" rel="noreferrer">Product ↗</a>}</li>)}</ul>
            <strong>List subtotal: {money(products.reduce((sum, { item, product }) => sum + product.regularCents! * item.quantity, 0))}</strong>
            <button type="button" onClick={() => void copyList(store.name, products)}>Copy this store’s list</button>
          </article>;
        })}</div>
        {copied && <p role="status">{copied}</p>}
        <div className="multi-store-total"><strong>Groceries: {money(plan.groceryCents)}</strong>
          <span>Driving: {money(plan.fuelCents)} · {plan.miles.toFixed(1)} road miles · about {Math.round(plan.minutes)} minutes</span>
          {plan.gasPurchaseCents > 0 && <span>Planned fill-up: {money(plan.gasPurchaseCents)} · {plan.gasStopIncluded ? "selected station" : "entered baseline estimate"}</span>}
          {gasStop && gasEconomics && <span>{plan.gasStopIncluded ? "Gas stop included: it lowers estimated total cost." : "Gas stop skipped: its detour does not save money."}</span>}
          <b>Estimated trip: {money(plan.totalCents)}</b></div>
        {savings !== null && <p className="small">{savings >= 0 ? `Estimated net savings: ${money(savings)}` : `Estimated extra cost: ${money(-savings)}`} compared with the lowest complete single-store trip.</p>}
        {belowThreshold && <p className="small" role="status">This manual plan does not meet your {money(requiredSavings)} extra-stop savings target, so it is not recommended.</p>}
        {!gasStop && <p className="small">Fuel uses your entered gas price; choose a station on the map to include its detour.</p>}
        {directionsUrl && <a className="multi-store-directions" href={directionsUrl} target="_blank" rel="noreferrer">Open route directions ↗</a>}
        <button type="button" className="multi-store-directions" onClick={() => savePlan(plan)}>Review this trip in Smart Cart →</button>
        <p className="small">Separate store lists; carts are not transferred. Taxes, stock, and checkout prices may change.</p>
      </> : <p className="small">Choose one priced product for every food to calculate a complete trip.</p>}
      {cartMessage && <p role="status">{cartMessage}</p>}
    </div>}
  </section>;
}
