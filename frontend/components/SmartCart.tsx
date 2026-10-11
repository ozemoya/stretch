"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import ProductImage from "./ProductImage";
import CartRouteMap from "./CartRouteMap";
import { readCart, writeCart, cartGroups, cartSubtotal, readCartOptions, replacementOptions, replaceCartLine, SMART_CART_EVENT, type CartLine } from "@/lib/smart-cart";
import { readCheckoutDraft, type CheckoutDraft } from "@/lib/checkout-draft";
import { centers } from "@/lib/locations";
import { bestRoadRoute, type RoadMatrix } from "@/lib/mix-match-optimizer";
import { fuelCostCents } from "@/lib/live-trip";
import { normalizedUnitPrice } from "@/lib/package-match";
import { catalogReferenceSubtotal, readCatalogPicks, writeCatalogPicks, type CatalogPick } from "@/lib/catalog-picks";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const FINALIZED_KEY = "stretch.finalized-trip.v1";
const CHECKLIST_KEY = "stretch.trip-checklist.v1";

export default function SmartCart({ checkout = false }: { checkout?: boolean }) {
  const [lines, setLines] = useState<CartLine[] | null>(null);
  const [picks, setPicks] = useState<CatalogPick[]>([]);
  const [options, setOptions] = useState<CartLine[]>([]);
  const [draft, setDraft] = useState<CheckoutDraft | null>(null);
  const [road, setRoad] = useState<{ key: string; matrix: RoadMatrix } | null>(null);
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "error">("idle");
  const [saved, setSaved] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");
  useEffect(() => {
    const sync = () => { setLines(readCart(localStorage)); setOptions(readCartOptions(localStorage));
      setPicks(readCatalogPicks(localStorage)); };
    sync();
    setDraft(readCheckoutDraft(sessionStorage));
    try { setChecked(JSON.parse(localStorage.getItem(CHECKLIST_KEY) || "{}")); } catch { setChecked({}); }
    window.addEventListener("storage", sync);
    window.addEventListener(SMART_CART_EVENT, sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener(SMART_CART_EVENT, sync); };
  }, []);
  const groups = useMemo(() => cartGroups(lines ?? []), [lines]);
  const displayGroups = useMemo(() => cartGroups((lines ?? []).map((line) => ({ ...line, selected: true })))
    .map((group) => ({ ...group, lines: (lines ?? []).filter((line) => line.store.id === group.store.id),
      subtotalCents: cartSubtotal((lines ?? []).filter((line) => line.store.id === group.store.id)) })), [lines]);
  const home = draft ? draft.origin ?? centers[draft.prefs.area] : null;
  const routeKey = JSON.stringify([home?.lat, home?.lon, groups.map((g) => [g.store.id, g.store.lat, g.store.lon]),
    draft?.gasStop?.id, draft?.gasStop?.lat, draft?.gasStop?.lon]);
  useEffect(() => {
    setRoad(null);
    if (!home || !groups.length || groups.length > 3) { setRouteStatus("idle"); return; }
    const controller = new AbortController();
    const points = [home, ...groups.map((g) => g.store), ...(draft?.gasStop ? [draft.gasStop] : [])]
      .map(({ lat, lon }) => ({ lat, lon }));
    setRouteStatus("loading");
    void fetch("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matrix: true, points }), signal: controller.signal })
      .then(async (response) => { if (!response.ok) throw new Error("Route unavailable"); return response.json(); })
      .then((data) => {
        if (controller.signal.aborted) return;
        setRoad({ key: routeKey, matrix: { storeIds: groups.map((g) => g.store.id),
          distances: data.distances, durations: data.durations, hasFuelStop: !!draft?.gasStop } });
        setRouteStatus("idle");
      }).catch(() => { if (!controller.signal.aborted) setRouteStatus("error"); });
    return () => controller.abort();
  }, [routeKey]);

  const matrix = road?.key === routeKey ? road.matrix : null;
  const route = matrix ? bestRoadRoute(groups.map((g) => g.store.id), matrix) : null;
  const groceryCents = cartSubtotal(lines ?? []);
  const noGasRoute = matrix?.hasFuelStop ? bestRoadRoute(groups.map((g) => g.store.id), { ...matrix, hasFuelStop: false }) : null;
  const reportAge = draft?.fuelSource ? Date.now() - Date.parse(draft.fuelSource.period) : Infinity;
  const recentStationReport = draft?.fuelSource?.kind === "station" && !!draft.gasStop &&
    Number.isFinite(reportAge) && reportAge >= 0 && reportAge <= 48 * 60 * 60 * 1000;
  const effectiveGasPrice = draft ? recentStationReport ? draft.prefs.gas : draft.manualGas : 0;
  const fuelCents = route && draft ? fuelCostCents(route.miles, draft.prefs.mpg, effectiveGasPrice) : null;
  const gasPurchaseCents = recentStationReport && draft?.gasGallonsNeeded
    ? Math.round(draft.gasGallonsNeeded * draft.fuelSource!.dollarsPerGallon * 100) : null;
  const baselineDrivingCents = noGasRoute && draft ? fuelCostCents(noGasRoute.miles, draft.prefs.mpg, draft.manualGas) : null;
  const baselinePurchaseCents = draft?.gasGallonsNeeded && draft.manualGas > 0
    ? Math.round(draft.gasGallonsNeeded * draft.manualGas * 100) : null;
  const plannedPurchaseCents = gasPurchaseCents ?? baselinePurchaseCents;
  const gasDetourSavingsCents = gasPurchaseCents !== null && baselineDrivingCents !== null && baselinePurchaseCents !== null && fuelCents !== null
    ? baselinePurchaseCents + baselineDrivingCents - gasPurchaseCents - fuelCents : null;
  useEffect(() => {
    if (!checkout || !lines || !route || fuelCents === null) return;
    try {
      const plan = JSON.parse(localStorage.getItem(FINALIZED_KEY) || "null");
      const current = lines.filter((line) => line.selected).map((line) => `${line.id}:${line.quantity}`).sort();
      const previous = Array.isArray(plan?.lines) ? plan.lines.map((line: CartLine) => `${line.id}:${line.quantity}`).sort() : [];
      setSaved(picks.length === 0 && current.length > 0 && JSON.stringify(current) === JSON.stringify(previous) &&
        plan.totalCents === groceryCents + fuelCents && plan.gasStop?.id === draft?.gasStop?.id);
    } catch { setSaved(false); }
  }, [checkout, lines, picks.length, route?.miles, groceryCents, fuelCents, draft?.gasStop?.id]);
  const directionsUrl = route && home ? (() => {
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", `${home.lat},${home.lon}`);
    url.searchParams.set("destination", `${home.lat},${home.lon}`);
    url.searchParams.set("waypoints", [...route.order.map((id) => {
      const store = groups.find((group) => group.store.id === id)!.store;
      return `${store.lat},${store.lon}`;
    }), ...(draft?.gasStop ? [`${draft.gasStop.lat},${draft.gasStop.lon}`] : [])].join("|"));
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  })() : null;

  function updateLines(next: CartLine[]) {
    if (!writeCart(localStorage, next)) { setMessage("Could not save cart changes on this device."); return; }
    localStorage.removeItem(FINALIZED_KEY);
    setLines(next); setSaved(false); setMessage("");
    window.dispatchEvent(new Event(SMART_CART_EVENT));
  }
  function updatePicks(next: CatalogPick[]) {
    if (!writeCatalogPicks(localStorage, next)) { setMessage("Could not save your selected products on this device."); return; }
    localStorage.removeItem(FINALIZED_KEY);
    setPicks(next); setSaved(false); setMessage("");
    window.dispatchEvent(new Event(SMART_CART_EVENT));
  }
  function finalize() {
    if (!lines?.length || picks.length || !draft || !route || fuelCents === null || groups.length > 3) return;
    const plan = { version: 1, savedAt: new Date().toISOString(), lines: lines.filter((line) => line.selected), stores: groups.map((g) => g.store),
      gasStop: draft.gasStop, fuelSource: draft.fuelSource, groceryCents, fuelCents,
      totalCents: groceryCents + fuelCents, miles: route.miles, minutes: route.minutes,
      routeOrder: route.order, directionsUrl };
    try { localStorage.setItem(FINALIZED_KEY, JSON.stringify(plan)); localStorage.removeItem(CHECKLIST_KEY);
      setChecked({}); setSaved(true); }
    catch { setMessage("Could not save your trip on this device."); }
  }
  function toggleCheck(id: string, value: boolean) {
    const next = { ...checked, [id]: value };
    setChecked(next);
    try { localStorage.setItem(CHECKLIST_KEY, JSON.stringify(next)); } catch { /* Browsers may block storage. */ }
  }
  if (lines === null) return <main className="smart-cart-page"><p role="status">Opening your cart…</p></main>;
  return <main className="smart-cart-page">
    <div className="smart-cart-heading"><div><p className="eyebrow">YOUR TRIP, YOUR WAY</p><h1>{checkout ? "Trip checkout" : "Smart Cart"}</h1>
      <p>{checkout ? "Review your store lists, route, and fuel estimate before saving your plan." : "Keep each item with the branch that supplied its price. Plan your drive before you shop."}</p></div>
      <Link href={checkout ? "/cart" : "/plan/results"}>← {checkout ? "Edit Smart Cart" : "Compare more stores"}</Link></div>
    {!lines.length && !picks.length ? <section className="smart-cart-empty"><h2>Your cart is empty</h2>
      <p>Choose products on Stores & Gas to build a trip.</p><Link className="cta" href="/plan/results">Find groceries ↗</Link></section> : <>
      <div className="smart-cart-grid"><section className="smart-cart-stores" aria-label="Store shopping lists">
        {picks.length > 0 && <article className="smart-cart-store catalog-picks"><div className="smart-cart-store-head"><div>
          <h2>Products picked from online catalogs</h2><p>These listings are saved for you, but no nearby branch price is confirmed yet.</p></div></div>
          {picks.map((pick) => <div className="smart-cart-line" key={pick.id}>
            <ProductImage name={pick.productName} brand={pick.brand} size={pick.size} retailerImageUrl={pick.imageUrl}
              retailerSourceUrl={pick.productUrl} />
            <div><strong>{pick.productName}</strong><small>{pick.retailerId} · {pick.size}</small>
              <small>Online reference: {money(pick.onlinePriceCents)} / package · observed {new Date(pick.observedAt).toLocaleString()}</small>
              <a href={pick.productUrl} target="_blank" rel="noreferrer">View retailer listing ↗</a></div>
            <div className="smart-cart-line-actions"><label>Qty <input type="number" min={1} max={99} value={pick.quantity}
              onChange={(event) => { const quantity = Number(event.target.value); if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 99)
                updatePicks(picks.map((entry) => entry.id === pick.id ? { ...entry, quantity } : entry)); }} /></label>
              <button type="button" onClick={() => updatePicks(picks.filter((entry) => entry.id !== pick.id))}>Remove</button></div>
          </div>)}
          <p className="smart-cart-subtotal">Online reference subtotal <strong>{money(catalogReferenceSubtotal(picks))}</strong></p>
          <p className="small">Excluded from the trip quote. Pick a branch-priced listing in Stores & Gas before finalizing.</p>
        </article>}
        {displayGroups.map((group) => <article className="smart-cart-store" key={group.store.id}>
          <div className="smart-cart-store-head"><div><h2>{group.store.name}</h2><p>{group.store.address}</p></div>
            <a href={group.store.mapUrl} target="_blank" rel="noreferrer">Map ↗</a></div>
          {group.lines.map((line) => <div className={`smart-cart-line${line.selected ? "" : " smart-cart-line-muted"}`} key={line.id}>
            <ProductImage name={line.product.productName} brand={line.product.brand} size={line.product.size}
              retailerImageUrl={line.product.imageUrl} retailerSourceUrl={line.product.imageSourceUrl} />
            <div><label className="smart-cart-select"><input type="checkbox" checked={line.selected}
              onChange={(event) => updateLines(lines.map((entry) => entry.id === line.id ? { ...entry, selected: event.target.checked } : entry))} /> Include in this trip</label>
              <strong>{line.product.productName}</strong><small>{line.product.size} · {line.product.priceSource}</small>
              {normalizedUnitPrice(line.product.regularCents, line.product.size) && <small>
                {money(normalizedUnitPrice(line.product.regularCents, line.product.size)!.displayCents)} / {normalizedUnitPrice(line.product.regularCents, line.product.size)!.displayUnit}</small>}
              <small>Price checked {new Date(line.product.verifiedAt).toLocaleString()}</small>
              <a href={line.product.productUrl!} target="_blank" rel="noreferrer">View at {group.store.name} ↗</a>
              {replacementOptions(line, options).length > 0 && <label className="smart-cart-replace">Switch to a verified listing
                <select value="" onChange={(event) => {
                  const option = options.find((entry) => entry.id === event.target.value);
                  if (option) updateLines(replaceCartLine(lines, line.id, option));
                }}><option value="">Choose a product and store</option>
                  {replacementOptions(line, options).map((option) => <option key={option.id} value={option.id}>
                    {option.store.name} · {option.product.productName} · {money(option.product.regularCents)}{option.product.regularCents < line.product.regularCents ? " · cheaper" : ""}
                  </option>)}</select></label>}</div>
            <div className="smart-cart-line-actions"><strong>{money(line.product.regularCents * line.quantity)}</strong>
              <label>Qty <input type="number" min={1} max={99} value={line.quantity}
                onChange={(event) => { const quantity = Number(event.target.value); if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 99)
                  updateLines(lines.map((entry) => entry.id === line.id ? { ...entry, quantity } : entry)); }} /></label>
              <button type="button" onClick={() => updateLines(lines.filter((entry) => entry.id !== line.id))}>Remove</button></div>
          </div>)}
          <p className="smart-cart-subtotal">Selected subtotal <strong>{money(group.subtotalCents)}</strong></p>
        </article>)}
      </section><aside className="smart-cart-summary"><h2>Trip estimate</h2>
        <p>Branch-confirmed groceries <strong>{groups.length ? money(groceryCents) : "Not yet priced"}</strong></p>
        {picks.length > 0 && <p>Online reference items <strong>{picks.length} · excluded</strong></p>}
        <p>Stores <strong>{groups.length} / 3</strong></p>
        {groups.length > 3 && <p role="alert">Choose items at no more than three stores to calculate a trip.</p>}
        {!draft && <p role="alert">Choose your starting area and vehicle details to calculate driving cost. <Link href="/plan">Trip settings ↗</Link></p>}
        {routeStatus === "loading" && <p role="status">Calculating road distance…</p>}
        {routeStatus === "error" && <p role="alert">Road routing is unavailable. Retry by refreshing this page.</p>}
        {route && draft && <><p>Driving <strong>{route.miles.toFixed(1)} mi · about {Math.round(route.minutes)} min</strong></p>
          <p>Driving fuel <strong>{fuelCents === null ? "Unavailable" : money(fuelCents)}</strong></p>
          <small>{draft.prefs.mpg} MPG · ${effectiveGasPrice.toFixed(3)}/gal {recentStationReport ?
            `reported at ${draft.gasStop?.name}; checked ${new Date(draft.fuelSource!.period).toLocaleString()}` : "entered estimate"}</small>
          <p className="smart-cart-grand">Estimated trip total <strong>{fuelCents === null ? "Unavailable" : money(groceryCents + fuelCents)}</strong></p></>}
        {plannedPurchaseCents !== null && fuelCents !== null && <><p>Optional fill-up ({draft?.gasGallonsNeeded} gal) <strong>{money(plannedPurchaseCents)}</strong></p>
          <p className="small">{gasPurchaseCents !== null ? "Based on the selected station's recent Google report." : "Based on your entered price; no station price is confirmed."}</p>
          <p className="smart-cart-grand">Including your fill-up <strong>{money(groceryCents + fuelCents + plannedPurchaseCents)}</strong></p></>}
        {gasDetourSavingsCents !== null && <p className="small" role="status">Against your entered ${draft!.manualGas.toFixed(3)}/gal baseline and the route without a gas stop, this stop {gasDetourSavingsCents > 0 ? `could save ${money(gasDetourSavingsCents)}` : `adds about ${money(-gasDetourSavingsCents)} in cost`}. This comparison is an estimate.</p>}
        {draft?.gasStop && plannedPurchaseCents === null && <p className="small">Fill-up cost is excluded because gallons needed and a usable price are missing.</p>}
        <p className="small">Driving fuel is fuel used for this route, not the cost of filling your tank. Taxes, fees, discounts, stock, and checkout prices are not confirmed or included.</p>
        {directionsUrl && <a className="cta" href={directionsUrl} target="_blank" rel="noreferrer">Open route directions ↗</a>}
        {checkout ? <button className="cta" type="button" disabled={picks.length > 0 || !route || fuelCents === null || groups.length > 3} onClick={finalize}>Finalize Shopping Plan</button>
          : <Link className="cta" href="/cart/checkout">Continue to checkout ↗</Link>}
        {picks.length > 0 && <p className="small" role="status">Your saved online items are not part of this trip total. Check their retailer pages or find branch-confirmed matches before finalizing.</p>}
        {saved && <p role="status">Shopping plan saved on this device. Use the checklist below when you shop.</p>}
        {message && <p role="alert">{message}</p>}
      </aside></div>
      {checkout && route && home && <section className="smart-cart-route"><h2>Your route</h2>
        <p>{draft?.origin?.label ?? `${draft?.prefs.area ?? "Starting"} area`} → {route.order.map((id) => groups.find((group) => group.store.id === id)?.store.name).join(" → ")}
          {draft?.gasStop ? ` → ${draft.gasStop.name}` : ""} → starting area</p>
        <CartRouteMap points={[home, ...route.order.map((id) => groups.find((group) => group.store.id === id)!.store), ...(draft?.gasStop ? [draft.gasStop] : [])]} />
        <p>{route.miles.toFixed(1)} road miles · about {Math.round(route.minutes)} minutes · {groups.length} grocery {groups.length === 1 ? "stop" : "stops"}</p>
        {draft && <p>{draft.prefs.mpg} MPG · {draft.fuelSource?.fuelType ?? "Fuel grade not supplied"} · ${effectiveGasPrice.toFixed(3)}/gal · approximately {(route.miles / draft.prefs.mpg).toFixed(2)} gallons used</p>}
      </section>}
      {saved && <section className="smart-cart-checklist"><h2>Shopping checklist</h2>{groups.map((group) => <div key={group.store.id}>
        <h3>{group.store.name}</h3><p>{group.store.address}</p><ul>{group.lines.map((line) => <li key={line.id}>
          <label><input type="checkbox" checked={!!checked[line.id]} onChange={(event) => toggleCheck(line.id, event.target.checked)} /> {line.quantity} × {line.product.productName} · {line.product.size}</label></li>)}</ul></div>)}
        <Link href="/cart">Edit this plan ↗</Link></section>}
      {draft && <p className="smart-cart-gas">Gas stop: {draft.gasStop?.name ?? "none selected"}. <Link href="/gas?return=cart">Compare reported pump prices ↗</Link></p>}
    </>}
  </main>;
}
