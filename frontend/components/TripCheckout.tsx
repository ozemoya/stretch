"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import TripFlowHeader from "./TripFlowHeader";
import { readCheckoutDraft, writeCheckoutDraft, type CheckoutDraft } from "@/lib/checkout-draft";
import { readTripReview, type TripReview } from "@/lib/trip-review";
import { canCreateInstacartList, copyableShoppingList, retailerShoppingUrl, shopifyCartUrl } from "@/lib/cart-handoff";
import { tripDirectionsUrl } from "@/lib/trip-directions";
import SketchIcon from "./SketchIcon";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function TripCheckout() {
  const [data, setData] = useState<{ draft: CheckoutDraft; review: TripReview } | null | undefined>(undefined);
  useEffect(() => {
    const draft = readCheckoutDraft(window.sessionStorage);
    const review = draft && readTripReview(window.sessionStorage, draft);
    setData(draft && review ? { draft, review } : null);
  }, []);

  return (
    <div className="trip-app trip-checkout-shell">
      <TripFlowHeader step={3} />
      <main id="checkout-main" className="trip-checkout-page">
        {data === undefined ? <p role="status">Opening your trip review…</p> : !data ? (
          <section className="trip-checkout-empty">
            <SketchIcon name="map" size={88} className="sketch-state-icon" />
            <p className="eyebrow">TRIP INCOMPLETE</p>
            <h1>Choose a store and gas station</h1>
            <p>Pick a store with a verified price for every food and select a gas station. Your review will appear here once the route is ready.</p>
            <Link className="cta" href="/plan/results">BACK TO STORES & GAS ↗</Link>
          </section>
        ) : <TripSummary draft={data.draft} review={data.review} />}
      </main>
    </div>
  );
}

function TripSummary({ draft, review }: { draft: CheckoutDraft; review: TripReview }) {
  const [instacartReady, setInstacartReady] = useState(false);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffNote, setHandoffNote] = useState("");
  const [gallonsNeeded, setGallonsNeeded] = useState<number | undefined>(draft.gasGallonsNeeded);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/live/status", { signal: controller.signal })
      .then((response) => response.json())
      .then((status) => { if (!controller.signal.aborted) setInstacartReady(status.instacart === true); })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const shopUrl = retailerShoppingUrl(review);
  const preloadedCartUrl = shopifyCartUrl(review);
  const directionsUrl = tripDirectionsUrl(draft, review);
  async function openInstacartList() {
    setHandoffBusy(true); setHandoffNote("");
    try {
      const response = await fetch("/api/cart/instacart", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(review),
        signal: AbortSignal.timeout(10_000) });
      const result = await response.json();
      if (!response.ok || typeof result.url !== "string") throw new Error(result.error || "Shopping list could not be created.");
      window.location.assign(result.url);
    } catch (error) {
      setHandoffNote(error instanceof Error ? error.message : "Shopping list could not be created.");
      setHandoffBusy(false);
    }
  }
  async function copyList() {
    try { await navigator.clipboard.writeText(copyableShoppingList(review)); setHandoffNote("Your selected products and available links were copied."); }
    catch { setHandoffNote("Copying is blocked in this browser. Use the product links shown in your list."); }
  }
  const station = draft.gasStop!;
  const quoteAge = draft.fuelSource ? Date.now() - Date.parse(draft.fuelSource.period) : Infinity;
  const recentStationPrice = draft.fuelSource?.kind === "station" &&
    Number.isFinite(quoteAge) && quoteAge >= 0 && quoteAge <= 48 * 60 * 60 * 1000;
  const fillUpCents = recentStationPrice && gallonsNeeded && gallonsNeeded > 0
    ? Math.round(gallonsNeeded * draft.fuelSource!.dollarsPerGallon * 100) : null;
  const displayTotalCents = review.totalCents + (fillUpCents ?? 0);
  const budgetLeft = Math.round(draft.prefs.budget * 100) - displayTotalCents;
  const oldestPrice = Math.min(...review.products.map((product) => Date.parse(product.verifiedAt)));
  const olderThanDay = Date.now() - oldestPrice > 24 * 60 * 60 * 1000;
  function updateGallons(value: number) {
    const next = Number.isFinite(value) && value > 0 && value <= 100 ? value : undefined;
    if (writeCheckoutDraft(window.sessionStorage, { ...draft, gasGallonsNeeded: next })) setGallonsNeeded(next);
  }
  return <>
    <div className="trip-checkout-heading">
      <div>
        <h1>Review your trip</h1>
        <p>Starting near {draft.origin?.label ?? draft.prefs.area} · {review.products.length} of {draft.items.length} items priced · {review.miles.toFixed(1)} miles round trip</p>
      </div>
      <Link href="/plan/results" className="results-edit">← Change store or station</Link>
    </div>
    <div className="trip-checkout-grid">
      <section className="trip-checkout-basket" aria-label="Chosen groceries">
        <p className="eyebrow">YOUR GROCERY STOP</p>
        <h2>{review.storeName}</h2>
        <p>{review.storeAddress}</p>
        <a href={review.storeMapUrl} target="_blank" rel="noreferrer">View this exact store location ↗</a>
        <ul>
          {review.products.map((product) => <li key={product.itemId}>
            <div>
              <strong>{product.productName}</strong>
              <small>{product.quantity} × {product.packageSize} · for {product.requestedName}</small>
              <small>{product.priceSource} · observed {new Date(product.verifiedAt).toLocaleString()}</small>
              {product.productUrl ? <a href={product.productUrl} target="_blank" rel="noreferrer">View product ↗</a>
                : <small>Product page link was not supplied by the price source.</small>}
            </div>
            <b>{money(product.lineTotalCents)}</b>
          </li>)}
        </ul>
        <Link href="/plan" className="results-edit">Edit food list</Link>
      </section>
      <aside className="trip-checkout-total" aria-label="Trip estimate">
        <SketchIcon name="coin" size={55} className="review-sticker" />
        <p className="eyebrow">ESTIMATED TOTAL</p>
        <h2>{money(displayTotalCents)}</h2>
        <p className="trip-checkout-total-caption">{fillUpCents !== null
          ? "Groceries + driving fuel + gas fill-up" : "Groceries + driving fuel; fill-up excluded"}</p>
        <dl>
          <div><dt>Groceries at {review.storeName}</dt><dd>{money(review.groceryCents)}</dd></div>
          <div><dt>Driving fuel · {review.miles.toFixed(1)} mi at {review.mpg} MPG</dt><dd>{money(review.fuelCents)}</dd></div>
          {fillUpCents !== null && <div><dt>Gas fill-up · {gallonsNeeded} gal at {station.name}</dt><dd>{money(fillUpCents)}</dd></div>}
          <div className="trip-checkout-total-row"><dt>{fillUpCents !== null ? "Estimated food + gas total" : "Food + driving estimate"}</dt><dd>{money(displayTotalCents)}</dd></div>
        </dl>
        <div className="trip-checkout-stop">
          <span className="trip-checkout-stop-icon" aria-hidden="true"><SketchIcon name="pump" size={32} /></span>
          <div><strong>Gas stop: {station.name}</strong><small>{station.address}</small>
            <small>${review.gasPrice.toFixed(2)}/gal · {review.gasPriceReported ? "reported price" : "your entered estimate"}</small>
            {draft.fuelSource && <small>Reported {new Date(draft.fuelSource.period).toLocaleString()} · <a href={draft.fuelSource.sourceUrl} target="_blank" rel="noreferrer">Price source ↗</a></small>}
            {recentStationPrice ? <label className="trip-checkout-gallons">Gallons to buy (optional)
              <input type="number" min="0" max="100" step="0.1" inputMode="decimal" value={gallonsNeeded ?? ""}
                onChange={(event) => updateGallons(Number(event.target.value))} placeholder="e.g. 10" />
            </label> : <small>Fill-up cost cannot be included because this station has no recent reported pump price.</small>}
            <a href={station.mapUrl} target="_blank" rel="noreferrer">Open station on map ↗</a>
          </div>
        </div>
        <p className="trip-budget-status">{budgetLeft >= 0 ? `${money(budgetLeft)} under your ${money(Math.round(draft.prefs.budget * 100))} budget` : `${money(-budgetLeft)} over your ${money(Math.round(draft.prefs.budget * 100))} budget`}</p>
        <p className="small">About {Math.round(review.minutes)} minutes of driving. Driving fuel is used on this route; a fill-up is added only with a recent reported pump price and entered gallons. Taxes, discounts, inventory, and checkout totals may change.</p>
        {olderThanDay && <p className="trip-checkout-warning" role="status">Some grocery prices were observed more than 24 hours ago. Recheck before leaving.</p>}
        {directionsUrl && <div className="trip-route-handoff">
          <h3>Directions</h3>
          <p>{draft.origin?.label} → {review.storeName} → {station.name} → starting area</p>
          <a className="trip-handoff-primary" href={directionsUrl} target="_blank" rel="noopener noreferrer">OPEN FULL TRIP DIRECTIONS ↗</a>
          <small>Directions start and end at your selected approximate area. Adjust the address in Maps before driving.</small>
        </div>}
        <div className="trip-handoff">
          <h3>Shop at this store</h3>
          {preloadedCartUrl && <>
            <a className="trip-handoff-primary" href={preloadedCartUrl} rel="noreferrer">OPEN PRELOADED CART AT {review.storeName.toUpperCase()} ↗</a>
            <p className="small">The selected product variants are passed to this shop’s cart. Confirm they appear, then review the pickup location and final prices before placing an order.</p>
          </>}
          {instacartReady && canCreateInstacartList(review) && <>
            <button type="button" className="trip-handoff-primary" disabled={handoffBusy} onClick={() => void openInstacartList()}>
              {handoffBusy ? "CREATING SHOPPING LIST…" : "SEND LIST TO INSTACART ↗"}
            </button>
            <p className="small">Instacart will ask you to select {review.storeName} and review the matched items before adding them to its cart. The exact branch and final prices must be confirmed there.</p>
          </>}
          {shopUrl && <a className="trip-handoff-shop" href={shopUrl} target="_blank" rel="noreferrer">OPEN {review.storeName.toUpperCase()} SHOP ↗</a>}
          <button type="button" className="trip-handoff-copy" onClick={() => void copyList()}>COPY SHOPPING LIST</button>
          {handoffNote && <p role="status" className="small">{handoffNote}</p>}
          <p className="small">This page plans your trip; payment happens at the retailer. Only the preloaded-cart option transfers variants. Direct shop links and copied lists require you to add items yourself.</p>
        </div>
        <div className="trip-checkout-actions">
          <Link className="cta" href="/plan/results">RECHECK PRICES ↗</Link>
          <button type="button" onClick={() => window.print()}>PRINT TRIP SUMMARY</button>
        </div>
      </aside>
    </div>
  </>;
}
