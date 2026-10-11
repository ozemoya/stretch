"use client";

import { useEffect, useMemo, useState } from "react";
import CartRouteMap from "./CartRouteMap";
import ProductImage from "./ProductImage";
import { compareGroceryTrips, type GroceryTripOption } from "@/lib/grocery-route-planner";
import type { RoadMatrix } from "@/lib/mix-match-optimizer";
import type { CartLine } from "@/lib/smart-cart";
import type { GasStop } from "@/lib/gas-stop";
import type { RoutePreviewStop } from "@/lib/route-preview";

type StoreGroup = { store: CartLine["store"]; lines: CartLine[]; subtotalCents: number };
type RoadRoute = { order: string[]; miles: number; minutes: number };
type Point = { lat: number; lon: number; name: string; address?: string; summary?: string };
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const PROGRESS_KEY = "stretch.route-progress.v1";

export default function GroceryRoutePlanner({ home, homeLabel, groups, alternatives, matrix, route,
  status, mpg, gasPrice, gasStop, directionsUrl, manualOrder, onChoose, onReorder, onOptimize,
  onRemoveStore, onRetry, onSave, canSave, canCompare, selectedMode, maxStores, previewStops,
  gasPurchaseCents, minExtraStopSavingsCents }: {
  home: { lat: number; lon: number } | null; homeLabel: string; groups: StoreGroup[];
  alternatives: CartLine[]; matrix: RoadMatrix | null; route: RoadRoute | null;
  previewStops: RoutePreviewStop[];
  status: "idle" | "loading" | "error"; mpg: number; gasPrice: number; gasStop: GasStop | null;
  directionsUrl: string | null; manualOrder: boolean;
  onChoose: (plan: GroceryTripOption, mode: "cheapest" | "fastest") => void;
  onReorder: (order: string[]) => void; onOptimize: () => void;
  onRemoveStore: (id: string) => void; onRetry: () => void; onSave: () => void; canSave: boolean;
  canCompare: boolean; selectedMode: "cheapest" | "fastest" | "custom" | null; maxStores: number;
  gasPurchaseCents: number; minExtraStopSavingsCents: number;
}) {
  const [selectedStop, setSelectedStop] = useState(0);
  const [completed, setCompleted] = useState<string[]>([]);
  const [remainingRoad, setRemainingRoad] = useState<{ key: string; miles: number; minutes: number } | null>(null);
  const [previewRoad, setPreviewRoad] = useState<{ key: string; miles: number; minutes: number } | null>(null);
  const activeLines = groups.flatMap((group) => group.lines);
  const choices = useMemo(() => matrix && canCompare
    ? compareGroceryTrips(activeLines, alternatives, matrix, mpg, gasPrice, maxStores,
      gasPurchaseCents, minExtraStopSavingsCents)
    : { cheapest: null, fastest: null }, [matrix, alternatives, groups, mpg, gasPrice,
      canCompare, maxStores, gasPurchaseCents, minExtraStopSavingsCents]);
  const ordered = route?.order.map((id) => groups.find((group) => group.store.id === id)!).filter(Boolean) ?? [];
  const orderKey = JSON.stringify([route?.order ?? [], activeLines.filter((line) => line.selected)
    .map((line) => [line.id, line.quantity]).sort()]);
  useEffect(() => {
    try {
      const progress = JSON.parse(sessionStorage.getItem(PROGRESS_KEY) || "null");
      setCompleted(progress?.orderKey === orderKey && Array.isArray(progress.completed)
        ? progress.completed.filter((id: unknown) => typeof id === "string") : []);
    } catch { setCompleted([]); }
    setSelectedStop(0);
  }, [orderKey]);
  function markCompleted(next: string[]) {
    setCompleted(next);
    try { sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ orderKey, completed: next })); }
    catch { /* Route progress still works for this visit if storage is blocked. */ }
    setSelectedStop(0);
  }
  const points: Point[] = home ? [{ ...home, name: "Start", address: homeLabel },
    ...ordered.map((group) => ({ ...group.store, summary: `${group.lines.length} items · ${money(group.subtotalCents)}` })),
    ...(gasStop ? [{ ...gasStop, summary: "Selected gas stop" }] : [])] : [];
  const completedCount = ordered.findIndex((group) => !completed.includes(group.store.id));
  const doneCount = completedCount < 0 ? ordered.length : completedCount;
  const remainingPoints: Point[] = home && doneCount > 0 ? [
    { ...ordered[doneCount - 1].store, name: `From ${ordered[doneCount - 1].store.name}` },
    ...ordered.slice(doneCount).map((group) => ({ ...group.store, summary: `${group.lines.length} items · ${money(group.subtotalCents)}` })),
    ...(gasStop ? [{ ...gasStop, summary: "Selected gas stop" }] : []),
    { ...home, name: "Return to start", address: homeLabel },
  ] : [];
  const activePoints = doneCount > 0 ? remainingPoints : points;
  const remainingKey = JSON.stringify(remainingPoints.map(({ lat, lon }) => [lat, lon]));
  const remainingLink = doneCount > 0 && remainingPoints.length >= 2 ? (() => {
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", `${remainingPoints[0].lat},${remainingPoints[0].lon}`);
    url.searchParams.set("destination", `${home!.lat},${home!.lon}`);
    url.searchParams.set("waypoints", remainingPoints.slice(1, -1).map(({ lat, lon }) => `${lat},${lon}`).join("|"));
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  })() : null;
  const stopIndex = (id: string) => matrix ? matrix.storeIds.indexOf(id) + 1 : -1;
  const nextLeg = (index: number) => {
    if (!matrix || !route) return null;
    const from = stopIndex(route.order[index]);
    const to = index + 1 < route.order.length ? stopIndex(route.order[index + 1]) :
      gasStop ? matrix.storeIds.length + 1 : 0;
    const metres = matrix.distances[from]?.[to], seconds = matrix.durations[from]?.[to];
    return metres == null || seconds == null ? null : { miles: metres / 1609.344, minutes: seconds / 60 };
  };
  const selected = activePoints[selectedStop];
  const previewKey = JSON.stringify([home, previewStops.map(({ id, lat, lon }) => [id, lat, lon]),
    gasStop && [gasStop.id, gasStop.lat, gasStop.lon]]);
  const previewDirections = home && previewStops.length ? (() => {
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", `${home.lat},${home.lon}`);
    url.searchParams.set("destination", `${home.lat},${home.lon}`);
    url.searchParams.set("waypoints", [...previewStops, ...(gasStop ? [gasStop] : [])]
      .map(({ lat, lon }) => `${lat},${lon}`).join("|"));
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  })() : null;
  return <section className="grocery-route-planner smart-cart-route" aria-labelledby="grocery-route-title">
    <div className="grocery-route-title"><div><p className="eyebrow">THE DRIVE</p><h2 id="grocery-route-title">Your grocery route</h2></div>
      {manualOrder && <button type="button" onClick={onOptimize}>Optimize stop order ↗</button>}</div>
    {matrix && groups.length > 0 && <div className="grocery-route-options" aria-label="Compare trip choices">
      {!canCompare && <p className="small">Choose a store-priced product for every grocery on your list to compare complete trips.</p>}
      {(["cheapest", "fastest"] as const).map((mode) => {
        const plan = choices[mode];
        return <article key={mode} className={`grocery-route-option${selectedMode === mode ? " is-selected" : ""}`}>
          <h3>{mode === "cheapest" ? "Cheapest Trip" : "Fastest Trip"}</h3>
          {plan ? <><p><strong>{plan.totalCents === null ? "Fuel estimate needed" : money(plan.totalCents)}</strong>
            <span>{Math.round(plan.minutes)} min · {plan.miles.toFixed(1)} mi</span></p>
            <small>{money(plan.groceryCents)} groceries · {plan.fuelCents === null ? "fuel not priced" : `${money(plan.fuelCents)} driving fuel`}
              {plan.gasPurchaseCents > 0 ? ` · ${money(plan.gasPurchaseCents)} fill-up` : ""} · {new Set(plan.lines.map((line) => line.store.id)).size} stores</small>
            <button type="button" aria-pressed={selectedMode === mode} onClick={() => onChoose(plan, mode)}>
              {selectedMode === mode ? "✓ Selected" : `Use ${mode === "cheapest" ? "cheapest" : "fastest"} trip`}
            </button></> : <p className="small">{mode === "cheapest" ? "A fuel estimate and complete store prices are needed." : "No complete drivable basket is available."}</p>}
        </article>;
      })}
      {choices.cheapest && choices.fastest && choices.fastest.minutes < choices.cheapest.minutes &&
        choices.cheapest.totalCents !== null && choices.fastest.totalCents !== null &&
        <p className="grocery-route-tradeoff" role="status">The fastest trip saves about {Math.round(choices.cheapest.minutes - choices.fastest.minutes)} minutes
          {choices.fastest.totalCents > choices.cheapest.totalCents
            ? ` for ${money(choices.fastest.totalCents - choices.cheapest.totalCents)} more.`
            : " without increasing the estimated total."}</p>}
      <p className="small">These compare store-priced products at up to eight eligible branches and {maxStores} stores.
        {minExtraStopSavingsCents > 0 ? ` When a complete one-store trip exists, each extra grocery stop must save at least ${money(minExtraStopSavingsCents)} after driving.` : ""}
        {" "}Drive times are estimates; traffic may change.</p>
    </div>}
    {route && home ? <>
      <p className="grocery-route-sequence">{homeLabel} → {ordered.map((group) => group.store.name).join(" → ")}
        {gasStop ? ` → ${gasStop.name}` : ""} → start</p>
      <CartRouteMap points={activePoints} selectedIndex={selectedStop} onSelect={setSelectedStop}
        roundTrip={doneCount === 0} onRoute={doneCount > 0 ? (result) => setRemainingRoad({ key: remainingKey, ...result }) : undefined} />
      {selected && <p className="grocery-route-selected" role="status"><strong>{selected.name}</strong>{selected.address ? ` · ${selected.address}` : ""}
        {selected.summary ? ` · ${selected.summary}` : ""}</p>}
      {doneCount > 0 && remainingRoad?.key === remainingKey ? <p role="status">Remaining drive: {remainingRoad.miles.toFixed(1)} road miles · about {Math.round(remainingRoad.minutes)} min from {ordered[doneCount - 1].store.name}.</p> :
        <p>{route.miles.toFixed(1)} road miles · about {Math.round(route.minutes)} min · {mpg > 0 ? `${(route.miles / mpg).toFixed(2)} gallons used at ${mpg} MPG` : "MPG needed"}</p>}
      <p className="small">{matrix?.provider === "google" ? "Google Routes driving estimate with traffic-aware travel time." :
        "Road-router driving estimate. Live traffic is not included."}</p>
      <div className="grocery-route-stops">{ordered.map((group, index) => {
        const leg = nextLeg(index);
        return <article className="grocery-route-stop" key={group.store.id}>
          <button className="grocery-route-stop-title" type="button" onClick={() => setSelectedStop(index + 1)}>
            <span>STOP {index + 1}</span><strong>{group.store.name}</strong><small>{group.store.address}</small>
          </button>
          <ul>{group.lines.map((line) => <li key={line.id}>
            <ProductImage name={line.product.productName} brand={line.product.brand} size={line.product.size}
              retailerImageUrl={line.product.imageUrl} retailerSourceUrl={line.product.imageSourceUrl} />
            <span>{line.quantity} × {line.product.productName}</span><b>{money(line.product.regularCents * line.quantity)}</b>
          </li>)}</ul>
          <p>Store subtotal <strong>{money(group.subtotalCents)}</strong></p>
          {leg && <small>Next leg: {leg.miles.toFixed(1)} mi · about {Math.round(leg.minutes)} min</small>}
          <div className="grocery-route-stop-actions">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${group.store.lat},${group.store.lon}&travelmode=driving`}
              target="_blank" rel="noopener noreferrer" aria-label={`Directions to ${group.store.name}`}>Directions ↗</a>
            <button type="button" disabled={index === 0} onClick={() => { const next = [...route.order]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onReorder(next); }}>↑ Earlier</button>
            <button type="button" disabled={index === ordered.length - 1} onClick={() => { const next = [...route.order]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; onReorder(next); }}>↓ Later</button>
            <button type="button" onClick={() => onRemoveStore(group.store.id)}>Remove stop</button>
            <button type="button" aria-pressed={completed.includes(group.store.id)}
              disabled={index > 0 && !completed.includes(ordered[index - 1].store.id)}
              onClick={() => markCompleted(completed.includes(group.store.id)
                ? completed.filter((id) => route.order.indexOf(id) < index) : [...completed, group.store.id])}>
              {completed.includes(group.store.id) ? "✓ Completed" : "Mark completed"}</button>
          </div>
        </article>;
      })}</div>
      {gasStop && <p className="grocery-route-gas">Gas stop after groceries: <strong>{gasStop.name}</strong> · {gasStop.address}</p>}
      <div className="grocery-route-actions">
        {(remainingLink ?? directionsUrl) && <a href={remainingLink ?? directionsUrl!} target="_blank" rel="noopener noreferrer">Start grocery route in Google Maps ↗</a>}
        <button type="button" disabled={!canSave} onClick={onSave}>Save shopping route</button>
      </div>
      {doneCount > 0 && <p className="small">The remaining route starts at the last completed store, then visits unfinished stops and returns to the starting area. Stretch does not provide turn-by-turn navigation.</p>}
    </> : home && previewStops.length && !groups.length ? <div className="grocery-route-preview">
      <p><strong>Grocery route preview:</strong> {homeLabel} → {previewStops.map((stop) => stop.name).join(" → ")}
        {gasStop ? ` → ${gasStop.name}` : ""} → start</p>
      <ol className="grocery-route-preview-stops">{previewStops.map((stop) =>
        <li key={stop.id}><strong>{stop.name}</strong><span>{stop.address}</span></li>)}</ol>
      <CartRouteMap points={[{ ...home, name: "Start", address: homeLabel },
        ...previewStops.map((stop) => ({ ...stop, summary: "Mapped grocery location; price not linked" })),
        ...(gasStop ? [{ ...gasStop, summary: "Selected gas stop" }] : [])]}
        onRoute={(result) => setPreviewRoad({ key: previewKey, ...result })} />
      {previewRoad?.key === previewKey && <p>{previewRoad.miles.toFixed(1)} road miles · about {Math.round(previewRoad.minutes)} min round trip</p>}
      <p className="small">These are mapped store locations. Online catalog items are not assigned to these branches, and their prices are excluded from a verified trip total.</p>
      {previewDirections && <a href={previewDirections} target="_blank" rel="noopener noreferrer">Open preview directions ↗</a>}
    </div> : <div className="smart-cart-route-pending" role="status"><p>{status === "loading" ? "Calculating your road route…" :
      status === "error" ? "Driving directions could not be loaded." : "Choose a store-priced product to see a route."}</p>
      {status === "error" && <button type="button" onClick={onRetry}>Retry route</button>}
    </div>}
  </section>;
}
