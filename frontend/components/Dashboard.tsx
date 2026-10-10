"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readCheckoutDraft, type CheckoutDraft } from "@/lib/checkout-draft";
import { readSavedLists, type SavedList } from "@/lib/saved-plans";
import SketchIcon from "./SketchIcon";

export default function Dashboard() {
  const [draft, setDraft] = useState<CheckoutDraft | null>(null);
  const [lists, setLists] = useState<SavedList[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => { setDraft(readCheckoutDraft(sessionStorage)); setLists(readSavedLists(localStorage)); setReady(true); }, []);
  return <main className="dashboard-page">
    <div className="dashboard-heading"><div><p className="eyebrow">DASHBOARD</p><h1>Plan your grocery trip</h1><p>Make a list, compare store prices, and check the cost of the drive.</p></div><Link className="desktop-primary" href="/plan">New grocery list <span>↗</span></Link></div>
    <div className="dashboard-metrics">
      <section><SketchIcon name="tag" size={39} className="metric-icon" /><span>Your trip budget</span><strong>{draft ? `$${draft.prefs.budget.toFixed(0)}` : "—"}</strong><Link href="/plan?panel=settings">Adjust your preferences →</Link></section>
      <section><SketchIcon name="map" size={39} className="metric-icon" /><span>Saved lists</span><strong>{ready ? lists.length : "—"}<small>lists</small></strong><small>Available on this device</small></section>
    </div>
    <div className="dashboard-grid">
      <section className="dashboard-journey"><SketchIcon name="star" size={52} className="journey-doodle" /><p className="eyebrow">GET STARTED</p><h2>What do you need<br />this week?</h2><p>Add your groceries, then compare prices from available stores and choose a gas stop.</p><Link className="desktop-primary" href={draft?.items.length ? "/plan/results" : "/plan"}>{draft?.items.length ? "Continue your comparison" : "Start with your groceries"} ↗</Link><div className="journey-track"><span>1<small>Your list</small></span><i /><span>2<small>Stores & gas</small></span><i /><span>3<small>Trip review</small></span></div></section>
      <section className="dashboard-card"><div className="card-title"><h2>Recent lists</h2><Link href="/lists">View all ↗</Link></div>{lists.length ? <ul className="dashboard-lists">{lists.slice(0, 4).map((list) => <li key={list.id}><span className="list-symbol"><SketchIcon name="bag" size={26} /></span><div><strong>{list.name}</strong><small>{list.basket.length} items · {new Date(list.savedAt).toLocaleDateString()}</small></div><Link href={`/plan?listId=${encodeURIComponent(list.id)}`} aria-label={`Use ${list.name}`}>↗</Link></li>)}</ul> : <div className="dashboard-empty"><SketchIcon name="bag" size={70} className="sketch-state-icon" /><h3>No saved lists yet</h3><p>Save a grocery list and reuse it next week. Prices are checked again each trip.</p><Link href="/plan">Create your first list →</Link></div>}</section>
      <section className="dashboard-card coverage-note"><span className="status-pill">SCOPE FYI</span><h2>Where prices come from</h2><p>We’re collecting prices from larger grocery chains first. A small neighborhood store may appear on the map even when we don’t have its product prices yet. We only compare a store when its own listings have prices.</p><Link href="/plan/results">See stores near you ↗</Link></section>
    </div>
  </main>;
}
