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
import type { NearbyPlace } from "@/lib/live-data";
import { nearbyGroceryStores } from "@/lib/nearby-store-display";

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
  const [selectedPlaceId, setSelectedPlaceId] = useState<string | null>(null);
  const groceryStores = nearbyGroceryStores(nearbyPlaces, storeQuery);
  const groceryCount = nearbyGroceryStores(nearbyPlaces).length;
  const [draft, setDraft] = useState<CheckoutDraft | null | undefined>(
    undefined,
  );

  useEffect(() => {
    setDraft(readCheckoutDraft(window.sessionStorage));
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

  return (
    <div className="trip-app">
      <TripFlowHeader
        step={draft === null || draft?.items.length === 0 ? 1 : 2}
      />
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
          Map & gas
        </button>
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
                  {draft.prefs.gas.toFixed(2)} per gallon
                </p>
              </details>
              <PriceAgent
                autoStart
                items={draft.items}
                zip={draft.origin?.zip ?? centers[draft.prefs.area].zip}
                area={draft.prefs.area}
                origin={draft.origin}
                gasStop={draft.gasStop}
                gasPrice={draft.prefs.gas}
                gasPriceReported={!!draft.fuelSource}
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
                <p className="small">These locations are on the map. Only stores with their own confirmed prices appear in trip comparisons.</p>
                <label className="nearby-grocery-search">
                  Find a store
                  <input type="search" value={storeQuery} onChange={(event) => { setStoreQuery(event.target.value); setStoreLimit(20); }} placeholder="Search names or addresses" />
                </label>
                <div className="nearby-grocery-list">
                  {groceryStores.slice(0, storeLimit).map((store) => (
                    <button type="button" key={store.id} aria-pressed={selectedPlaceId === store.id}
                      onClick={() => { setSelectedPlaceId((current) => current === store.id ? null : store.id); setWorkspaceTab("map"); }}>
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
            <section
              className="results-map-panel"
              aria-label="Nearby stores and gas map"
            >
              <StopFinder
                compact
                autoLoad
                area={draft.prefs.area}
                origin={draft.origin}
                selectedStation={draft.gasStop}
                radius={radius}
                onRadiusChange={setRadius}
                onPlaces={setNearbyPlaces}
                onPlacesError={setPlacesError}
                selectedPlaceId={selectedPlaceId}
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
          </>
        )}
      </main>
    </div>
  );
}
