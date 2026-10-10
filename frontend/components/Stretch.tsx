"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TripFlowHeader from "./TripFlowHeader";
import OpenMap from "./OpenMap";
import type { NearbyPlace } from "@/lib/live-data";
const emptyMapPlaces: NearbyPlace[] = [];
import type { BasketItem, Catalog, Preferences } from "@/lib/types";
import { detectLocation } from "@/lib/detect-location";
import { centers, type SearchOrigin } from "@/lib/locations";
import type { FuelQuote } from "@/lib/live-data";
import type { GasStop } from "@/lib/gas-stop";
import { readCheckoutDraft, writeCheckoutDraft } from "@/lib/checkout-draft";
import { createSavedList, readSavedLists, readSavedSettings, writeSavedLists, writeSavedSettings, type SavedList } from "@/lib/saved-plans";
import SketchIcon, { type SketchIconName } from "./SketchIcon";
const defaults: Preferences = {
  area: "downtown",
  budget: 35,
  mpg: 25,
  gas: 3.5,
  maxStops: 2,
  vegan: false,
  glutenFree: false,
  nutFree: false,
};
const sampleTrips = {
  a: { label: "Market A", groceries: 52, driving: 3 },
  b: { label: "Market B", groceries: 47, driving: 9 },
  both: { label: "Two stores", groceries: 43, driving: 5 },
} as const;
type SampleTrip = keyof typeof sampleTrips;

function foodIcon(name: string): SketchIconName {
  if (/milk|cream|yogurt|cheese/i.test(name)) return "milk";
  if (/egg/i.test(name)) return "eggs";
  if (/bread|bagel|toast|bun/i.test(name)) return "bread";
  if (/apple|banana|berry|fruit|vegetable|tomato|lettuce|potato|onion|carrot/i.test(name)) return "produce";
  return "bag";
}

function Route() {
  const [selected, setSelected] = useState<SampleTrip>("both");
  const trip = sampleTrips[selected];
  return (
    <div
      className="route-illustration"
      role="region"
      aria-label="Sample grocery trip comparison"
    >
      <div className="route-map" data-selected={selected}>
        <SketchIcon name="bag" size={86} className="route-sticker route-sticker-bag" />
        <SketchIcon name="car" size={88} className="route-sticker route-sticker-car" />
        <SketchIcon name="star" size={40} className="route-sticker route-sticker-star" />
        <span className="hand route-note">
          a little detour.
          <br />a lot more dinner.
        </span>
        <svg viewBox="0 0 440 330" aria-hidden="true">
          <defs>
            <filter id="stretch-route-sketch" x="-15%" y="-15%" width="130%" height="130%">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="1" result="noise">
                <animate attributeName="seed" values="1;2;3;1" dur="0.55s" repeatCount="indefinite" />
              </feTurbulence>
              <feDisplacementMap in="SourceGraphic" in2="noise" scale="3" xChannelSelector="R" yChannelSelector="G" />
            </filter>
          </defs>
          <path d={selected === "a"
            ? "M80 220 C35 120 110 50 200 60 C290 90 170 320 80 220"
            : selected === "b"
              ? "M80 220 C150 135 275 145 360 225 C295 325 175 330 80 220"
              : "M80 220 C35 120 110 50 200 60 S405 120 360 225 S175 330 80 220"} />
          <path className="arrows" d="m200 60 15 5-10 12m145 235-15 2 3-15" />
        </svg>
        <span className="pin home" aria-hidden="true">⌂<small>HOME</small></span>
        <button type="button" className="pin first" aria-label="1 Market A — show sample trip" aria-pressed={selected === "a"} onClick={() => setSelected("a")}>1<small>MARKET A</small></button>
        <button type="button" className="pin second" aria-label="2 Market B — show sample trip" aria-pressed={selected === "b"} onClick={() => setSelected("b")}>2<small>MARKET B</small></button>
      </div>
      <div className="route-preview" aria-label="Try a sample trip">
        <div className="route-options" role="group" aria-label="Sample routes">
          {(Object.keys(sampleTrips) as SampleTrip[]).map((option) => (
            <button key={option} type="button" aria-pressed={selected === option} onClick={() => setSelected(option)}>{sampleTrips[option].label}</button>
          ))}
        </div>
        <p className="route-total" aria-live="polite">
          <span><strong>${trip.groceries}</strong> food</span>
          <span aria-hidden="true">+</span>
          <span><strong>${trip.driving}</strong> driving</span>
          <span aria-hidden="true">=</span>
          <strong className="route-grand-total">${trip.groceries + trip.driving}</strong>
        </p>
        <small>Sample prices to show how trip cost works.</small>
      </div>
    </div>
  );
}
export default function Stretch({
  catalog,
  mode = "home",
}: {
  catalog: Catalog;
  source: "demo" | "supabase";
  error?: string;
  mode?: "home" | "planner";
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [homeArea, setHomeArea] = useState("ip");
  useEffect(() => {
    if (searchParams.has("q")) setSearch(searchParams.get("q") ?? "");
    const panel = searchParams.get("panel");
    const element = document.querySelector<HTMLDetailsElement>(panel === "settings" ? ".trip-settings" : ".saved-lists");
    if (panel && element) element.open = true;
  }, [searchParams]);
  const [workspaceTab, setWorkspaceTab] = useState("list");
  const [basket, setBasket] = useState<BasketItem[]>([]),
    [prefs, setPrefs] = useState(defaults),
    [search, setSearch] = useState(""),
    [restored, setRestored] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [savedListName, setSavedListName] = useState("");
  const [savedListNotice, setSavedListNotice] = useState("");
  function persistBasket(nextBasket: BasketItem[], nextPrefs = prefs,
    nextOrigin = searchOrigin, nextIpArea = ipArea, nextManualGas = manualGas,
    nextGasStop = gasStop, nextFuelSource = fuelSource) {
    const items = nextBasket.flatMap((item) => {
      const product = catalog.products.find((entry) => entry.id === item.productId);
      return product ? [{ id: product.id, name: product.name, unit: product.unit,
        quantity: item.quantity }] : [];
    });
    if (items.length !== nextBasket.length) return false;
    return writeCheckoutDraft(window.sessionStorage, {
      version: 1, basket: nextBasket, items, prefs: nextPrefs,
      origin: nextOrigin, ipArea: nextIpArea, gasStop: nextGasStop,
      fuelSource: nextFuelSource, manualGas: nextManualGas,
    });
  }
  function saveList() {
    if (savedLists.length >= 20) {
      setSavedListNotice("You have 20 saved lists. Remove one before saving another."); return;
    }
    const next = createSavedList(crypto.randomUUID(), savedListName || "My grocery list", basket,
      { prefs, manualOrigin: ipArea ? null : searchOrigin });
    if (!next) { setSavedListNotice("Add food and use up to 99 of each item before saving."); return; }
    const updated = [next, ...savedLists];
    if (!writeSavedLists(window.localStorage, updated)) {
      setSavedListNotice("This browser could not save the list. Check storage permissions."); return;
    }
    setSavedLists(updated);
    setSavedListName("");
    setSavedListNotice(`Saved “${next.name}” on this device.`);
  }
  function loadList(list: SavedList) {
    const available = new Set(catalog.products.map((product) => product.id));
    const basket = list.basket.filter((item) => available.has(item.productId));
    if (!basket.length) { setSavedListNotice("The foods in this saved list are no longer in the catalog."); return; }
    setBasket(basket);
    setPrefs(list.prefs);
    setManualGas(list.prefs.gas);
    setFuelSource(null);
    setGasStop(null);
    setIpArea(!list.manualOrigin);
    if (list.manualOrigin) {
      setSearchOrigin(list.manualOrigin);
      setLocationState("Starting area selected manually");
    } else {
      setSearchOrigin(null);
      setLocationState("Detecting your current IP area…");
      const controller = new AbortController();
      detectLocation(controller.signal).then((origin) => {
        setSearchOrigin(origin);
        setLocationState("Approximate location from your IP");
      }).catch(() => setLocationState("Could not detect your area. Choose one in trip settings."));
    }
    setSearch("");
    persistBasket(basket, list.prefs, list.manualOrigin, !list.manualOrigin,
      list.prefs.gas, null, null);
    setSavedListNotice(basket.length === list.basket.length
      ? `Loaded “${list.name}”. Check your settings before searching.`
      : `Loaded “${list.name}” with ${list.basket.length - basket.length} unavailable food removed.`);
  }
  function deleteList(id: string) {
    const updated = savedLists.filter((list) => list.id !== id);
    if (!writeSavedLists(window.localStorage, updated)) {
      setSavedListNotice("This browser could not remove the saved list."); return;
    }
    setSavedLists(updated);
    setSavedListNotice("Saved list removed.");
  }
  function checkout() {
    if (!basket.length) return;
    setCheckoutError("");
    if (!searchOrigin) {
      setCheckoutError("Choose a starting area before continuing.");
      return;
    }
    const items = basket.map((item) => {
      const product = catalog.products.find(
        (entry) => entry.id === item.productId,
      );
      return (
        product && {
          id: product.id,
          name: product.name,
          unit: product.unit,
          quantity: item.quantity,
        }
      );
    });
    if (
      items.some((item) => !item) ||
      !Number.isFinite(prefs.gas) ||
      !Number.isFinite(prefs.mpg)
    ) {
      setCheckoutError("Check your list and trip settings before continuing.");
      return;
    }
    const saved = writeCheckoutDraft(window.sessionStorage, {
      version: 1,
      basket: basket.map((item) => ({ ...item })),
      items: items.filter((item): item is NonNullable<typeof item> => !!item),
      prefs,
      origin: searchOrigin,
      ipArea,
      gasStop,
      fuelSource,
      manualGas,
    });
    if (!saved) {
      setCheckoutError(
        "Could not save this trip in your browser. Check your settings and try again.",
      );
      return;
    }
    router.push("/plan/results");
  }
  const [fuelSource, setFuelSource] = useState<FuelQuote | null>(null);
  const [gasStop, setGasStop] = useState<GasStop | null>(null);
  const [manualGas, setManualGas] = useState(defaults.gas);
  const [searchOrigin, setSearchOrigin] = useState<SearchOrigin | null>(null);
  const [ipArea, setIpArea] = useState(true);
  const [locationState, setLocationState] = useState("Detecting your IP area…");
  useEffect(() => {
    if (mode !== "planner") return;
    setSavedLists(readSavedLists(window.localStorage));
    setRestored(true);
    const requestedArea = searchParams.get("area");
    const selectedArea = requestedArea && Object.prototype.hasOwnProperty.call(centers, requestedArea)
      ? requestedArea as Preferences["area"] : null;
    const previous = readCheckoutDraft(window.sessionStorage);
    if (previous) {
      setBasket(previous.basket);
      setPrefs(previous.prefs);
      setSearchOrigin(previous.origin);
      setIpArea(previous.ipArea);
      setGasStop(previous.gasStop);
      setFuelSource(previous.fuelSource);
      setManualGas(previous.manualGas);
      if (selectedArea) {
        setPrefs({ ...previous.prefs, area: selectedArea });
        setSearchOrigin({ ...centers[selectedArea], label: selectedArea });
        setIpArea(false);
        setLocationState("Starting area selected manually");
        return;
      }
      if (!previous.ipArea) {
        setSearchOrigin(
          previous.origin ?? {
            ...centers[previous.prefs.area],
            label: previous.prefs.area,
          },
        );
        setLocationState("Starting area selected manually");
        return;
      }
      if (previous.origin) {
        setLocationState("Approximate location from your IP");
        return;
      }
    }
    const savedSettings = readSavedSettings(window.localStorage);
    if (!previous && savedSettings) {
      setPrefs(savedSettings.prefs);
      setManualGas(savedSettings.prefs.gas);
      if (selectedArea) {
        setPrefs({ ...savedSettings.prefs, area: selectedArea });
        setSearchOrigin({ ...centers[selectedArea], label: selectedArea });
        setIpArea(false);
        setLocationState("Starting area selected manually");
        return;
      }
      if (savedSettings.manualOrigin) {
        setIpArea(false);
        setSearchOrigin(savedSettings.manualOrigin);
        setLocationState("Starting area selected manually");
        return;
      }
    }
    if (selectedArea) {
      setPrefs({ ...defaults, area: selectedArea });
      setSearchOrigin({ ...centers[selectedArea], label: selectedArea });
      setIpArea(false);
      setLocationState("Starting area selected manually");
      return;
    }
    const controller = new AbortController();
    detectLocation(controller.signal)
      .then((origin) => {
        if (!controller.signal.aborted) {
          setSearchOrigin(origin);
          setLocationState("Approximate location from your IP");
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLocationState(
            "Could not detect your area. Choose a starting area below.",
          );
      });
    return () => controller.abort();
  }, [mode]);
  useEffect(() => {
    if (mode !== "planner" || !restored) return;
    writeSavedSettings(window.localStorage, { prefs, manualOrigin: ipArea ? null : searchOrigin });
  }, [mode, restored, prefs, ipArea, searchOrigin]);
  useEffect(() => {
    if (mode !== "planner" || !restored) return;
    const items = basket.flatMap((item) => {
      const product = catalog.products.find((p) => p.id === item.productId);
      return product
        ? [
            {
              id: product.id,
              name: product.name,
              unit: product.unit,
              quantity: item.quantity,
            },
          ]
        : [];
    });
    writeCheckoutDraft(window.sessionStorage, {
      version: 1,
      basket,
      items,
      prefs,
      origin: searchOrigin,
      ipArea,
      gasStop,
      fuelSource,
      manualGas,
    });
  }, [
    mode,
    restored,
    basket,
    catalog,
    prefs,
    searchOrigin,
    ipArea,
    gasStop,
    fuelSource,
    manualGas,
  ]);
  function quantity(id: string, change: number) {
    const q = Math.min(99, Math.max(0,
      (basket.find((item) => item.productId === id)?.quantity ?? 0) + change));
    const next = [...basket.filter((item) => item.productId !== id),
      ...(q ? [{ productId: id, quantity: q }] : [])];
    setBasket(next);
    persistBasket(next);
  }
  function change<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    if (key === "gas") {
      setFuelSource(null);
      setManualGas(value as number);
    }
    if (key === "area") {
      setGasStop(null);
      setFuelSource(null);
      setPrefs((old) => ({
        ...old,
        area: value as Preferences["area"],
        gas: manualGas,
      }));
      return;
    }
    setPrefs((old) => ({ ...old, [key]: value }));
  }
  function plan() {
    router.push("/plan");
  }
  return (
    <div className={mode === "planner" ? "trip-app" : "stretch-home"}>
      {mode === "planner" ? (
        <TripFlowHeader step={1} />
      ) : (
        <>
          <a className="skip" href="#main-content">
            Skip to main content
          </a>
          <header>
            <a href="#" aria-label="Stretch home">
              <img
                className="logo"
                src="/assets/stretch-logo-transparent.png"
                alt="Stretch"
              />
            </a>
          </header>
        </>
      )}
      {mode === "planner" && (
        <div className="workspace-tabs" role="group" aria-label="Planner view">
          <button
            aria-pressed={workspaceTab === "list"}
            onClick={() => setWorkspaceTab("list")}
          >
            My list
          </button>
          <button
            aria-pressed={workspaceTab === "map"}
            onClick={() => setWorkspaceTab("map")}
          >
            Area map
          </button>
        </div>
      )}
      <main
        data-view={workspaceTab}
        id="main-content"
        className={mode === "planner" ? "trip-planner-page" : undefined}
      >
        {mode === "home" && (
          <section className="hero" aria-labelledby="home-title">
            <div className="home-hero-copy">
              <p className="eyebrow">MADE FOR EVERYDAY ATLANTA ADVENTURES</p>
              <h1 id="home-title">
                The little trip
                <br />
                that stretches
                <br />
                <span className="hero-scribble">your budget.</span>
              </h1>
              <p>
                Your list, a smarter route, and more left over.
                <br />
                Compare verified local baskets and the drive home.
              </p>
              <form className="home-search" onSubmit={(event) => {
                event.preventDefault();
                const params = new URLSearchParams();
                params.set("q", search.trim());
                if (homeArea !== "ip") params.set("area", homeArea);
                router.push(`/plan?${params.toString()}`);
              }}>
                <label htmlFor="home-food-search">What do you need?</label>
                <div className="home-search-row">
                  <SketchIcon name="cart" size={34} />
                  <input id="home-food-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search groceries, like milk or bread" required />
                  <button type="submit" aria-label="Search groceries">↗</button>
                </div>
                <div className="home-search-footer">
                  <label htmlFor="home-area">Starting area</label>
                  <select id="home-area" value={homeArea} onChange={(event) => setHomeArea(event.target.value)}>
                    <option value="ip">Near me · approximate IP area</option>
                    <option value="downtown">Downtown Atlanta</option>
                    <option value="midtown">Midtown Atlanta</option>
                    <option value="decatur">Decatur</option>
                  </select>
                </div>
              </form>
              <div className="home-hero-actions"><button className="cta" onClick={() => router.push("/dashboard")}>Start Here!</button><span>Atlanta-area pilot · prices shown only with a source.</span></div>
            </div>
            <Route />
          </section>
        )}
        {mode === "planner" && (
          <section id="planner" className="planner">
            <div className="section-head">
              <div>
                <p className="eyebrow">STEP 1 OF 3 · YOUR FOOD LIST</p>
                <h1>Grocery list</h1>
                <p>
                  Build or reuse a list, then compare supported local prices and
                  nearby gas stops. Unverified stores stay out of trip totals.
                </p>
              </div>
            </div>
            <details className="trip-settings">
              <summary>
                Trip settings · ${prefs.budget} budget ·{" "}
                {searchOrigin?.label || "Detecting your area…"}
              </summary>
              <div className="settings">
                <label>
                  Starting area
                  <select
                    value={
                      searchOrigin && ipArea
                        ? "ip"
                        : searchOrigin
                          ? prefs.area
                          : "pending"
                    }
                    onChange={(e) => {
                      if (
                        e.target.value === "ip" ||
                        e.target.value === "pending"
                      )
                        return;
                      const area = e.target.value as Preferences["area"];
                      change("area", area);
                      setIpArea(false);
                      setSearchOrigin({ ...centers[area], label: area });
                      setLocationState("Starting area selected manually");
                    }}
                  >
                    {!searchOrigin && (
                      <option value="pending">{locationState}</option>
                    )}
                    {searchOrigin && ipArea && (
                      <option value="ip">
                        Current IP area: {searchOrigin.label}
                      </option>
                    )}
                    <option value="downtown">Downtown Atlanta</option>
                    <option value="midtown">Midtown Atlanta</option>
                    <option value="decatur">Decatur</option>
                  </select>
                  <small>{locationState}</small>
                </label>
                {(["budget", "mpg", "gas"] as const).map((k) => (
                  <label key={k}>
                    {
                      {
                        budget: "Budget ($)",
                        mpg: "Vehicle MPG",
                        gas: "Gas / gallon ($)",
                      }[k]
                    }
                    <input
                      type="number"
                      min={k === "mpg" ? 1 : 0}
                      step={k === "mpg" ? 1 : 0.01}
                      value={Number.isNaN(prefs[k]) ? "" : prefs[k]}
                      onChange={(e) =>
                        change(
                          k,
                          e.target.value === "" ? NaN : Number(e.target.value),
                        )
                      }
                    />
                  </label>
                ))}
                <label>
                  Maximum stops
                  <select
                    value={prefs.maxStops}
                    onChange={(e) => change("maxStops", Number(e.target.value))}
                  >
                    <option value={1}>One stop</option>
                    <option value={2}>Two stops</option>
                  </select>
                </label>
              </div>
              <div className="filters">
                {(["vegan", "glutenFree", "nutFree"] as const).map((k) => (
                  <label key={k}>
                    <input
                      type="checkbox"
                      checked={prefs[k]}
                      onChange={(e) => change(k, e.target.checked)}
                    />
                    {
                      {
                        vegan: "Vegan",
                        glutenFree: "Gluten-free",
                        nutFree: "Nut-free",
                      }[k]
                    }
                  </label>
                ))}
                <span>
                  Keep your dietary preferences with your trip. Confirm
                  suitability on each product label.
                </span>
              </div>
              <p className="small">
                Dietary tags are sample data. Confirm ingredients and allergen
                labels before buying.
              </p>
            </details>
            <details className="saved-lists">
              <summary>Saved lists · {savedLists.length}</summary>
              <div className="saved-lists-content">
              <div className="saved-list-controls">
                <label>List name
                  <input value={savedListName} maxLength={60} placeholder="Weekly groceries" onChange={(event) => setSavedListName(event.target.value)} />
                </label>
                <button type="button" disabled={!basket.length} onClick={saveList}>SAVE CURRENT LIST</button>
              </div>
              {savedLists.length ? <ul>{savedLists.map((list) => <li key={list.id}>
                <span><strong>{list.name}</strong><small>{list.basket.length} foods · {new Date(list.savedAt).toLocaleDateString()}</small></span>
                <button type="button" onClick={() => loadList(list)}>Use list</button>
                <button type="button" aria-label={`Delete ${list.name}`} onClick={() => deleteList(list.id)}>Remove</button>
              </li>)}</ul> : <p className="small">No saved lists yet. Add food, then save it for next time.</p>}
              <p className="small">Saved on this device only. Prices and availability are checked again each trip.</p>
              {savedListNotice && <p role="status" className="small">{savedListNotice}</p>}
              </div>
            </details>
            <div className="planner-grid">
              <div>
                <div className="search-row">
                  <label>
                    Find a staple
                    <input
                      placeholder="Search your groceries…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <button
                    className="text-button"
                    onClick={() => {
                      setBasket([]);
                      persistBasket([]);
                    }}
                  >
                    Clear list
                  </button>
                </div>
                <div className="products">
                  {!search.trim() && !basket.length && (
                    <div className="empty-list sketch-empty-state">
                      <SketchIcon name="bag" size={68} className="sketch-state-icon" />
                      <p>Your grocery list is empty. Search for a food to add it.</p>
                    </div>
                  )}
                  {catalog.products
                    .filter((p) =>
                      search.trim()
                        ? (p.name + " " + p.category)
                            .toLowerCase()
                            .includes(search.trim().toLowerCase())
                        : basket.some((item) => item.productId === p.id),
                    )
                    .map((p) => {
                      const q =
                        basket.find((i) => i.productId === p.id)?.quantity ?? 0;
                      return (
                        <article
                          key={p.id}
                          className={q ? "product added" : "product"}
                        >
                          <span className="emoji"><SketchIcon name={foodIcon(p.name)} size={38} /></span>
                          <h3>{p.name}</h3>
                          <small>{p.unit}</small>
                          <div className="quantity">
                            <button
                              onClick={() => quantity(p.id, -1)}
                              disabled={!q}
                              aria-label={"Remove one " + p.name}
                            >
                              −
                            </button>
                            <output aria-label={p.name + " quantity"}>
                              {q}
                            </output>
                            <button
                              onClick={() => quantity(p.id, 1)}
                              disabled={q === 99}
                              aria-label={"Add one " + p.name}
                            >
                              +
                            </button>
                          </div>
                        </article>
                      );
                    })}
                </div>
              </div>
              <aside aria-live="polite">
                <p>
                  {basket.length} {basket.length === 1 ? "food" : "foods"}{" "}
                  selected. Next, compare nearby stores and choose your gas
                  stop.
                </p>
                <button
                  className="cta"
                  disabled={
                    !basket.length ||
                    !searchOrigin ||
                    basket.some((i) => i.quantity > 20)
                  }
                  onClick={checkout}
                >
                  CONTINUE TO STORES & GAS →
                </button>
                {checkoutError && (
                  <p className="alert" role="alert">
                    {checkoutError}
                  </p>
                )}
                {basket.some((item) => item.quantity > 20) && (
                  <p role="alert">Use up to 20 of each food per search.</p>
                )}
                <p className="small">
                  Prices and driving costs are compared in the next step.
                </p>
              </aside>
            </div>
          </section>
        )}
        {mode === "planner" && (
          <section className="planner-area-map" aria-label="Your starting area">
            <div className="map-panel-heading">
              <p className="eyebrow">LOCATION</p>
              <h2>Your starting area</h2>
              <p>
                {searchOrigin?.label ||
                  "Choose a starting area in trip settings."}
              </p>
            </div>
            {searchOrigin ? (
              <OpenMap
                area={prefs.area}
                origin={searchOrigin}
                radius={5}
                places={emptyMapPlaces}
              />
            ) : (
              <p role="status">{locationState}</p>
            )}
            <p className="small">
              Add your food first. Nearby stores and gas stops appear in step 2.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
