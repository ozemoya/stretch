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

export default function CheckoutResults() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [workspaceTab, setWorkspaceTab] = useState("list");
  useEffect(() => { setWorkspaceTab(searchParams.get("view") === "map" ? "map" : "list"); }, [searchParams]);
  const [reviewError, setReviewError] = useState("");
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
                  <p className="eyebrow">
                    STEP 2 OF 3 · YOUR STORES & GAS STOPS
                  </p>
                  <h1>Compare stores and gas</h1>
                  <p>
                    {draft.items.length}{" "}
                    {draft.items.length === 1 ? "food" : "foods"} on your list
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
                  Review your food list · {draft.items.length}{" "}
                  {draft.items.length === 1 ? "food" : "foods"}
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
