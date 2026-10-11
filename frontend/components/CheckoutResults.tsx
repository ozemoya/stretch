"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import StopFinder from "./StopFinder";
import PriceAgent from "./PriceAgent";
import TripFlowHeader from "./TripFlowHeader";
import { centers } from "@/lib/locations";
import {
  readCheckoutDraft,
  writeCheckoutDraft,
  type CheckoutDraft,
} from "@/lib/checkout-draft";
import { createTripReview, writeTripReview } from "@/lib/trip-review";
import SketchIcon from "./SketchIcon";
import { productRouteStop } from "@/lib/product-route-stop";
import type { NearbyPlace } from "@/lib/live-data";
import { nearbyGroceryStores } from "@/lib/nearby-store-display";
import { readCart, SMART_CART_EVENT, type CartLine } from "@/lib/smart-cart";
import { readCatalogPicks, type CatalogPick } from "@/lib/catalog-picks";
import { missingCartItems } from "@/lib/cart-coverage";
import { readRoutePreviewStops, toggleRoutePreviewStop, writeRoutePreviewStops,
  type RoutePreviewStop, MAX_PREVIEW_STORES } from "@/lib/route-preview";

export default function CheckoutResults() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [workspaceTab, setWorkspaceTab] = useState("list");
  useEffect(() => { setWorkspaceTab(searchParams.get("view") === "map" ? "map" : "list"); }, [searchParams]);
  const [reviewError, setReviewError] = useState("");
  const [radius, setRadius] = useState(5);
  const [nearbyPlaces, setNearbyPlaces] = useState<NearbyPlace[]>([]);
  const [placesError, setPlacesError] = useState("");
  const [storeQuery, setStoreQuery] = useState("");
  const [storeLimit, setStoreLimit] = useState(20);
  const [selectedPreviewStops, setSelectedPreviewStops] = useState<RoutePreviewStop[]>([]);
  const [routeNotice, setRouteNotice] = useState("");
  const [pendingRetailer, setPendingRetailer] = useState<string | null>(null);
  const groceryStores = nearbyGroceryStores(nearbyPlaces, storeQuery);
  const groceryCount = nearbyGroceryStores(nearbyPlaces).length;
  const selectedPlaceIds = selectedPreviewStops.map((stop) => stop.id);
  const [draft, setDraft] = useState<CheckoutDraft | null | undefined>(
    undefined,
  );
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [catalogPicks, setCatalogPicks] = useState<CatalogPick[]>([]);

  useEffect(() => {
    const saved = readCheckoutDraft(window.sessionStorage);
    if (saved?.origin?.source === "ip") {
      router.replace("/plan?panel=settings");
      return;
    }
    setDraft(saved);
    if (saved) setSelectedPreviewStops(readRoutePreviewStops(window.sessionStorage,
      saved.origin ?? centers[saved.prefs.area]));
  }, [router]);

  useEffect(() => {
    const syncCart = () => {
      setCartLines(readCart(window.localStorage));
      setCatalogPicks(readCatalogPicks(window.localStorage));
    };
    syncCart();
    window.addEventListener("storage", syncCart);
    window.addEventListener(SMART_CART_EVENT, syncCart);
    return () => {
      window.removeEventListener("storage", syncCart);
      window.removeEventListener(SMART_CART_EVENT, syncCart);
    };
  }, []);

  useEffect(() => {
    if (draft) writeCheckoutDraft(window.sessionStorage, draft);
  }, [draft]);

  function update(change: (current: CheckoutDraft) => CheckoutDraft) {
    setDraft((current) => {
      if (!current) return current;
      return change(current);
    });
  }

  const maxRouteStores = Math.min(MAX_PREVIEW_STORES, Math.max(1, draft?.prefs.maxStops ?? MAX_PREVIEW_STORES));
  function selectGroceryStop(place: NearbyPlace) {
    const next = toggleRoutePreviewStop(selectedPreviewStops, place, maxRouteStores);
    if (next === selectedPreviewStops) {
      setRouteNotice(`Choose up to ${maxRouteStores} grocery stores. Remove one to add another.`);
      return;
    }
    setRouteNotice("");
    setSelectedPreviewStops(next);
    if (draft) writeRoutePreviewStops(window.sessionStorage, next,
      draft.origin ?? centers[draft.prefs.area]);
  }
  function clearGroceryStops() {
    setSelectedPreviewStops([]);
    setRouteNotice("");
    if (draft) writeRoutePreviewStops(window.sessionStorage, [],
      draft.origin ?? centers[draft.prefs.area]);
  }

  function showProductRoute(retailer: string, location?: NearbyPlace) {
    const place = location ?? productRouteStop(retailer, nearbyPlaces);
    setWorkspaceTab("map");
    if (!place) {
      setPendingRetailer(retailer);
      setSelectedPreviewStops([]);
      setRouteNotice(`Finding a nearby ${retailer} location for your route…`);
      return;
    }
    setPendingRetailer(null);
    setRouteNotice(location ? "" : `Route to the nearest ${retailer} location. Check availability with this store.`);
    setSelectedPreviewStops([place]);
    if (draft) writeRoutePreviewStops(sessionStorage, [place], draft.origin ?? centers[draft.prefs.area]);
  }
  useEffect(() => {
    if (pendingRetailer && nearbyPlaces.length) {
      const place = productRouteStop(pendingRetailer, nearbyPlaces);
      if (place) showProductRoute(pendingRetailer);
      else setRouteNotice(`No ${pendingRetailer} location was returned in this area. Increase the radius or choose another store.`);
    }
  }, [pendingRetailer, nearbyPlaces]);

  const reportAge = draft?.fuelSource ? Date.now() - Date.parse(draft.fuelSource.period) : Infinity;
  const recentStationPrice = !!draft?.gasStop && draft.fuelSource?.kind === "station" &&
    Number.isFinite(reportAge) && reportAge >= 0 && reportAge <= 48 * 60 * 60 * 1000;
  const effectiveGasPrice = recentStationPrice ? draft!.prefs.gas : draft?.manualGas ?? 0;
  const missingItems = draft ? missingCartItems(draft.items, cartLines, catalogPicks) : [];
  const canCheckout = !!draft?.gasStop && !!draft.items.length && missingItems.length === 0;

  return (
    <div className="trip-app results-trip">
      <TripFlowHeader
        step={draft === null || draft?.items.length === 0 ? 1 : 2}
      />
      <div className="results-controls">
        <div className="workspace-tabs" role="group" aria-label="Results view">
          <button
            aria-pressed={workspaceTab === "list"}
            onClick={() => setWorkspaceTab("list")}
          >
            Store prices
          </button>
          <button
            aria-pressed={workspaceTab === "map"}
            onClick={() => setWorkspaceTab("map")}
          >
            Map & route
          </button>
        </div>
      </div>
      <main data-view={workspaceTab} id="results-main" className="results-page">
        {draft === undefined ? (
          <p role="status">Opening your trip…</p>
        ) : !draft?.items.length ? (
          <section className="results-empty">
            <SketchIcon name="bag" size={96} className="sketch-state-icon" />
            <p className="eyebrow">NO GROCERIES ADDED</p>
            <h1>Add groceries to compare stores</h1>
            <p>
              Add groceries and choose a starting area to compare stores and
              fuel.
            </p>
            <Link className="cta" href="/plan">
              BUILD MY LIST ↗
            </Link>
          </section>
        ) : (
          <>
            <section
              className="results-list-panel"
              aria-label="Your list and store prices"
            >
              <div className="results-intro">
                <div>
                  <h1>Compare stores and gas</h1>
                  <p>
                    {draft.items.length}{" "}
                    {draft.items.length === 1 ? "item" : "items"} on your list
                    {draft.origin
                      ? ` · Starting near ${draft.origin.label}`
                      : ` · ${draft.prefs.area} area`}
                    {` · $${draft.prefs.budget.toFixed(2)} budget`}
                  </p>
                </div>
                <Link className="results-edit" href="/plan">
                  ← Edit your food list
                </Link>
              </div>
              <details className="trip-review-list">
                <summary>
                  Your list · {draft.items.length}{" "}
                  {draft.items.length === 1 ? "item" : "items"}
                </summary>
                <ul className="trip-list-summary">
                  {draft.items.map((item) => (
                    <li key={item.id}>
                      <span>
                        {item.name}
                        <small>{item.unit}</small>
                      </span>
                      <b>× {item.quantity}</b>
                    </li>
                  ))}
                </ul>
                <p className="small">
                  Vehicle: {draft.prefs.mpg} MPG · Fuel: $
                  {effectiveGasPrice.toFixed(2)} per gallon
                </p>
              </details>
              <PriceAgent
                onProductAdded={showProductRoute}
                autoStart
                items={draft.items}
                zip={draft.origin?.zip ?? centers[draft.prefs.area].zip}
                area={draft.prefs.area}
                origin={draft.origin}
                gasStop={draft.gasStop}
                gasPrice={effectiveGasPrice}
                gasPriceReported={recentStationPrice}
                gasEconomics={recentStationPrice && draft.gasGallonsNeeded && draft.manualGas > 0 && draft.fuelSource
                  ? { gallonsNeeded: draft.gasGallonsNeeded, baselinePrice: draft.manualGas, stationPrice: draft.fuelSource.dollarsPerGallon }
                  : undefined}
                mpg={draft.prefs.mpg}
                maxStops={draft.prefs.maxStops}
                minExtraStopSavings={draft.prefs.minExtraStopSavings}
                shoppingPriority={draft.prefs.shoppingPriority}
                nearbyPlaces={nearbyPlaces}
                radius={radius}
                onSelectTrip={(store, selected, route, storeLocation) => {
                  const latest = readCheckoutDraft(window.sessionStorage);
                  const review = latest && createTripReview(latest, store, selected, route, storeLocation);
                  if (!review || !writeTripReview(window.sessionStorage, review)) {
                    setReviewError("This trip could not be verified for review. Refresh the prices and try again.");
                    return;
                  }
                  setReviewError("");
                  router.push("/plan/review");
                }}
              />
              {reviewError && <p role="alert">{reviewError}</p>}
              <details className="nearby-grocery-directory" aria-label="Nearby grocery store locations">
                <summary>Browse mapped grocery stores · {groceryCount} within {radius} miles</summary>
                <p className="small">These locations are on the map. Trip comparisons include stores with prices for your items.</p>
                <label className="nearby-grocery-search">
                  Find a store
                  <input type="search" value={storeQuery} onChange={(event) => { setStoreQuery(event.target.value); setStoreLimit(20); }} placeholder="Search names or addresses" />
                </label>
                <div className="nearby-grocery-list">
                  {groceryStores.slice(0, storeLimit).map((store) => (
                    <button type="button" key={store.id} aria-pressed={selectedPlaceIds.includes(store.id)}
                      onClick={() => { selectGroceryStop(store); setWorkspaceTab("map"); }}>
                      <span><strong>{store.name}</strong><small>{store.address || "Address not listed"}</small></span>
                      <span>{store.miles} mi <span aria-hidden="true">↗</span></span>
                    </button>
                  ))}
                  {!groceryCount && <p role={placesError ? "alert" : "status"}>{placesError || "Finding nearby grocery stores…"}</p>}
                  {!!groceryCount && !groceryStores.length && <p>No stores match that search.</p>}
                </div>
                {groceryStores.length > storeLimit && <button type="button" className="directory-more" onClick={() => setStoreLimit((count) => count + 20)}>Show 20 more stores</button>}
              </details>
            </section>
            <aside className="results-sidebar" aria-label="Nearby stops and checkout">
            <section
              className="results-map-panel"
              aria-label="Nearby stores and gas map"
            >
              <details className="results-route-callout">
                <summary>My trip · {selectedPreviewStops.length} of {maxRouteStores} stores selected</summary>
                {selectedPreviewStops.length ? <><ol>{selectedPreviewStops.map((stop) =>
                  <li key={stop.id}><span>{stop.name} · {stop.address}</span>
                    <button type="button" aria-label={`Remove ${stop.name} from route`}
                      onClick={() => { const place = nearbyPlaces.find((candidate) => candidate.id === stop.id);
                        if (place) selectGroceryStop(place); else {
                          const next = selectedPreviewStops.filter((entry) => entry.id !== stop.id);
                          setSelectedPreviewStops(next);
                          if (draft) writeRoutePreviewStops(window.sessionStorage, next,
                            draft.origin ?? centers[draft.prefs.area]);
                        } }}>×</button></li>)}</ol>
                  {canCheckout
                    ? <Link href="/cart/checkout">See the full grocery route at checkout ↗</Link>
                    : <small>Choose your groceries and a gas station before checkout. Your route is shown on this map.</small>}
                  <small>These are mapped stops. Online prices are not confirmed for these branches.</small></>
                  : <span>Add a product to see directions to its store.</span>}
                {maxRouteStores < MAX_PREVIEW_STORES &&
                  <small>Your trip setting currently allows {maxRouteStores} grocery stores. <Link href="/plan?panel=settings">Change trip settings ↗</Link></small>}
              </details>
              {routeNotice && <p className="results-route-limit" role="alert">{routeNotice}</p>}
              <StopFinder
                compact
                autoLoad
                area={draft.prefs.area}
                origin={draft.origin}
                selectedStation={draft.gasStop}
                selectedQuote={draft.fuelSource}
                radius={radius}
                onRadiusChange={(nextRadius) => {
                  setRadius(nextRadius);
                  clearGroceryStops();
                }}
                onPlaces={setNearbyPlaces}
                onPlacesError={setPlacesError}
                selectedPlaceIds={selectedPlaceIds}
                productRoutePlaces={selectedPreviewStops.map((stop) => ({ ...stop, kind: "grocery", miles: 0, mapUrl: "https://maps.google.com" }))}
                onSelectPlace={(place) => { if (place.kind === "grocery") selectGroceryStop(place); }}
                onStation={(gasStop, fuelSource) =>
                  update((current) => ({
                    ...current,
                    gasStop,
                    fuelSource,
                    prefs: {
                      ...current.prefs,
                      gas: fuelSource?.dollarsPerGallon ?? current.manualGas,
                    },
                  }))
                }
              />
            </section>
              <div className="results-checkout-panel">
                <div className="results-checkout-action" tabIndex={!canCheckout ? 0 : undefined}
                  role={!canCheckout ? "group" : undefined}
                  aria-label={!canCheckout ? "Checkout unavailable" : undefined}
                  aria-describedby={!canCheckout ? "results-checkout-feedback" : undefined}>
                  {canCheckout
                    ? <Link className="results-checkout" href="/cart">Checkout →</Link>
                    : <button className="results-checkout" type="button" disabled aria-describedby="results-checkout-feedback">Checkout →</button>}
                  {!canCheckout && <div id="results-checkout-feedback" className="results-checkout-hint" role="tooltip">
                    <p><strong>To enable checkout:</strong></p>
                    <ul>
                      {!draft.gasStop && <li>Choose a gas station from the list or map.</li>}
                      {missingItems.length > 0 && <li>Choose a product for {missingItems.map((item) => item.name).join(", ")}.</li>}
                    </ul>
                  </div>}
                </div>
              </div>
            </aside>
          </>
        )}
      </main>
    </div>
  );
}
