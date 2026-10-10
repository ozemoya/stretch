"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readCheckoutDraft, type CheckoutDraft } from "@/lib/checkout-draft";
import { readSavedLists, type SavedList } from "@/lib/saved-plans";
import { readTripReview, type TripReview } from "@/lib/trip-review";

export default function Dashboard() {
  const [draft, setDraft] = useState<CheckoutDraft | null>(null);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [review, setReview] = useState<TripReview | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { const current = readCheckoutDraft(sessionStorage); setDraft(current); setLists(readSavedLists(localStorage)); setReview(current ? readTripReview(sessionStorage, current) : null); setReady(true); }, []);
  return <main className="dashboard-page">
    <div className="dashboard-heading"><div><p className="eyebrow">DASHBOARD</p><h1>Plan your grocery trip</h1><p>Make a list, compare store prices, and check the cost of the drive.</p></div><Link className="desktop-primary" href="/plan">New grocery list <span>↗</span></Link></div>
    <div className="dashboard-metrics">
      <section><span>On your list</span><strong>{ready ? draft?.items.length ?? 0 : "—"}<small>items</small></strong><Link href="/plan">Manage groceries →</Link></section>
      <section><span>Reviewed groceries</span><strong>{review ? `$${(review.groceryCents / 100).toFixed(2)}` : "—"}</strong><small>{review ? "From your latest trip review" : "Compare a complete basket first"}</small></section>
      <section><span>Your trip budget</span><strong>{draft ? `$${draft.prefs.budget.toFixed(0)}` : "—"}</strong><Link href="/plan?panel=settings">Adjust your preferences →</Link></section>
      <section><span>Saved lists</span><strong>{ready ? lists.length : "—"}<small>lists</small></strong><small>Available on this device</small></section>
    </div>
    <div className="dashboard-grid">
      <section className="dashboard-journey"><p className="eyebrow">GET STARTED</p><h2>What do you need<br />this week?</h2><p>Add your groceries, then compare prices from available stores and choose a gas stop.</p><Link className="desktop-primary" href={draft?.items.length ? "/plan/results" : "/plan"}>{draft?.items.length ? "Continue your comparison" : "Start with your groceries"} ↗</Link><div className="journey-track"><span>1<small>Your list</small></span><i /><span>2<small>Stores & gas</small></span><i /><span>3<small>Trip review</small></span></div></section>
      <section className="dashboard-card"><div className="card-title"><h2>Recent lists</h2><Link href="/plan?panel=list">View all ↗</Link></div>{lists.length ? <ul className="dashboard-lists">{lists.slice(0, 4).map((list) => <li key={list.id}><span className="list-symbol">☷</span><div><strong>{list.name}</strong><small>{list.basket.length} items · {new Date(list.savedAt).toLocaleDateString()}</small></div><Link href="/plan?panel=list" aria-label={`Open saved lists to use ${list.name}`}>↗</Link></li>)}</ul> : <div className="dashboard-empty"><span>☷</span><h3>No saved lists yet</h3><p>Save a grocery list and reuse it next week. Prices are checked again each trip.</p><Link href="/plan">Create your first list →</Link></div>}</section>
      <section className="dashboard-card"><div className="card-title"><h2>Worth the drive?</h2><span className="status-pill">Trip estimate</span></div>{review ? <><h3>{review.storeName}</h3><p>{review.storeAddress}</p><div className="trip-equation"><span>${(review.groceryCents / 100).toFixed(2)}<small>groceries</small></span><b>+</b><span>${(review.fuelCents / 100).toFixed(2)}<small>driving fuel</small></span><b>=</b><span>${(review.totalCents / 100).toFixed(2)}<small>estimated trip</small></span></div><Link href="/plan/review">Review your route →</Link></> : <><p className="dashboard-explainer">Your trip total includes groceries and driving fuel.</p><p>Choose a store and gas station to see the estimate. Stores with missing prices cannot be compared as complete baskets.</p><Link href="/plan/results">Compare stores →</Link></>}</section>
      <section className="dashboard-card coverage-note"><span className="status-pill">Price availability</span><h2>Which stores can I compare?</h2><p>Coverage depends on the store. We show the source and date for each price, and label online prices when they haven’t been confirmed at your local store.</p><Link href="/plan/results">Check available prices ↗</Link></section>
    </div>
  </main>;
}
