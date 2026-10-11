"use client";
import { useEffect, useRef, useState } from "react";
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
import { addSearchItems } from "@/lib/search-basket";
import { createSavedList, readSavedLists, readSavedSettings, writeSavedLists, writeSavedSettings, type SavedList } from "@/lib/saved-plans";
import SketchIcon, { type SketchIconName } from "./SketchIcon";
const defaults: Preferences = {
  area: "downtown",
  budget: 35,
  mpg: 25,
  gas: 3.5,
  maxStops: 3,
  minExtraStopSavings: 5,
  shoppingPriority: "balanced",
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
    const settings = document.querySelector<HTMLDetailsElement>(".trip-settings");
    if (panel === "settings" && settings) settings.open = true;
  }, [searchParams]);
  const [workspaceTab, setWorkspaceTab] = useState("list");
  const [basket, setBasket] = useState<BasketItem[]>([]),
    [prefs, setPrefs] = useState(defaults),
    [search, setSearch] = useState(""),
    [modalSearch, setModalSearch] = useState(""),
    [restored, setRestored] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [savedListName, setSavedListName] = useState("");
  const [savedListNotice, setSavedListNotice] = useState("");
  const [searchNotice, setSearchNotice] = useState("");
  const handledSearchRef = useRef<string | null>(null);
  const [isAddItemsOpen, setIsAddItemsOpen] = useState(false);
  const addItemsTriggerRef = useRef<HTMLButtonElement>(null);
  const addItemsModalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!isAddItemsOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const modal = addItemsModalRef.current;
    const trigger = addItemsTriggerRef.current;
    modal?.querySelector<HTMLElement>("input, button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [isAddItemsOpen]);
  function handleModalKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      setIsAddItemsOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const modal = addItemsModalRef.current;
    if (!modal) return;
    const focusable = Array.from(
      modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
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
    // Selecting a new comparison starts a new trip; a station from an older trip
    // must not satisfy the gas-stop step automatically.
    setGasStop(null);
    setFuelSource(null);
    const saved = writeCheckoutDraft(window.sessionStorage, {
      version: 1,
      basket: basket.map((item) => ({ ...item })),
      items: items.filter((item): item is NonNullable<typeof item> => !!item),
      prefs,
      origin: searchOrigin,
      ipArea,
      gasStop: null,
      fuelSource: null,
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
    const listId = searchParams.get("listId");
    if (!listId) return;
    const list = readSavedLists(window.localStorage).find((entry) => entry.id === listId);
    if (list) loadList(list);
  }, [mode, restored, searchParams]);
  useEffect(() => {
    if (mode !== "planner" || !restored) return;
    const query = searchParams.get("q");
    if (query === null) {
      handledSearchRef.current = null;
      return;
    }
    if (handledSearchRef.current === query) return;
    handledSearchRef.current = query;
    const result = addSearchItems(query, catalog.products, []);
    setBasket((current) => addSearchItems(query, catalog.products, current).basket);
    setSearch(result.unmatched[0] ?? "");
    setSearchNotice([
      result.matched.length ? `In your list: ${result.matched.map((product) => product.name).join(", ")}.` : "",
      result.unmatched.length ? `No catalog match for: ${result.unmatched.join(", ")}. Use Add Items to find another grocery.` : "",
    ].filter(Boolean).join(" "));
    const params = new URLSearchParams(searchParams.toString());
    params.delete("q");
    router.replace(`/plan${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  }, [mode, restored, searchParams, catalog.products, router]);
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
  function removeItem(id: string) {
    const next = basket.filter((item) => item.productId !== id);
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
                if (!search.trim()) return;
                const params = new URLSearchParams();
                params.set("q", search.trim());
                if (homeArea !== "ip") params.set("area", homeArea);
                router.push(`/plan?${params.toString()}`);
              }}>
                <label htmlFor="home-food-search">What do you need?</label>
                <div className="home-search-row">
                  <SketchIcon name="cart" size={34} />
                  <input id="home-food-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search groceries, like milk, eggs and bread" required />
                  <button type="submit" aria-label="Search groceries">↗</button>
                </div>
                <div className="home-search-footer">
                  <label htmlFor="home-area">Starting area</label>
                  <select id="home-area" value={homeArea} onChange={(event) => setHomeArea(event.target.value)}>
                    <option value="ip">Near me</option>
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
                <h1>Grocery list</h1>
                <p>Add what you need, then compare stores and the drive.</p>
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
                    <option value={3}>Three stops</option>
                  </select>
                </label>
                <label>
                  Minimum savings per extra stop ($)
                  <input type="number" min={0} max={1000} step={0.5}
                    value={prefs.minExtraStopSavings}
                    onChange={(e) => change("minExtraStopSavings", e.target.value === "" ? 5 : Number(e.target.value))} />
                </label>
                <label>
                  Shopping priority
                  <select value={prefs.shoppingPriority} onChange={(e) => change("shoppingPriority", e.target.value as Preferences["shoppingPriority"])}>
                    <option value="balanced">Balanced</option>
                    <option value="lowest_cost">Lowest trip cost</option>
                    <option value="fewest_stops">Fewest stops</option>
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
            <div className="planner-grid">
              <div>
                <div className="add-items-prompt">
                  <div>
                    <h2>Add groceries</h2>
                    {searchNotice && <p role="status">{searchNotice}</p>}
                  </div>
                  <button
                    type="button"
                    className="add-items-button"
                    ref={addItemsTriggerRef}
                    onClick={() => {
                      setModalSearch(search);
                      setIsAddItemsOpen(true);
                    }}
                  >
                    <span>＋</span> ADD ITEMS
                  </button>
                </div>
              </div>
              <aside aria-live="polite">
                <div className="current-list-panel">
                  <div className="current-list-heading">
                    <div>
                      <p className="eyebrow">YOUR ACTIVE LIST</p>
                      <h2>{basket.length ? `${basket.length} ${basket.length === 1 ? "item" : "items"}` : "Start your list"}</h2>
                    </div>
                    {!!basket.length && (
                      <button
                        type="button"
                        className="text-button current-list-clear"
                        onClick={() => {
                          setBasket([]);
                          persistBasket([]);
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {basket.length ? (
                    <ul className="current-list-items">
                      {basket.map((item) => {
                        const product = catalog.products.find((entry) => entry.id === item.productId);
                        if (!product) return null;
                        return (
                          <li key={item.productId}>
                            <span className="current-list-icon">
                              <SketchIcon name={foodIcon(product.name)} size={25} />
                            </span>
                            <span className="current-list-item-name">
                              <strong>{product.name}</strong>
                              <small>{product.unit}</small>
                            </span>
                            <span className="quantity compact-quantity">
                              <button
                                type="button"
                                onClick={() => quantity(product.id, -1)}
                                aria-label={`Remove one ${product.name}`}
                              >
                                −
                              </button>
                              <output aria-label={`${product.name} quantity`}>{item.quantity}</output>
                              <button
                                type="button"
                                onClick={() => quantity(product.id, 1)}
                                disabled={item.quantity === 99}
                                aria-label={`Add one ${product.name}`}
                              >
                                +
                              </button>
                            </span>
                            <button
                              type="button"
                              className="remove-list-item"
                              onClick={() => removeItem(product.id)}
                              aria-label={`Remove ${product.name} from list`}
                            >
                              ×
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="current-list-empty">
                      <SketchIcon name="bag" size={42} />
                      <p>Search for a staple and tap <strong>+</strong> to build your list.</p>
                    </div>
                  )}
                </div>
                <details className="save-list-card">
                  <summary>Save this list for later</summary>
                  <label htmlFor="active-list-name">List name</label>
                  <input
                    id="active-list-name"
                    value={savedListName}
                    maxLength={60}
                    placeholder="Weekly groceries"
                    onChange={(event) => setSavedListName(event.target.value)}
                  />
                  <button type="button" className="save-list-button" disabled={!basket.length} onClick={saveList}>
                    SAVE LIST <span>↗</span>
                  </button>
                  {savedListNotice && <p role="status" className="save-list-notice">{savedListNotice}</p>}
                </details>
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
                {!basket.length && (
                  <p className="small">Add at least one food to continue.</p>
                )}
                {basket.length > 0 && !searchOrigin && (
                  <p className="small">Choose a starting area to continue.</p>
                )}
                {checkoutError && (
                  <p className="alert" role="alert">
                    {checkoutError}
                  </p>
                )}
                {basket.some((item) => item.quantity > 20) && (
                  <p role="alert">Use up to 20 of each food per search.</p>
                )}
              </aside>
            </div>
            {isAddItemsOpen && (
              <div
                className="add-items-overlay"
                role="presentation"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) setIsAddItemsOpen(false);
                }}
              >
                <section
                  className="add-items-modal"
                  ref={addItemsModalRef}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="add-items-title"
                  onKeyDown={handleModalKeyDown}
                >
                  <div className="add-items-modal-heading">
                    <div>
                      <p className="eyebrow">YOUR PANTRY, YOUR WAY</p>
                      <h2 id="add-items-title">Add items</h2>
                      <p>Tap + to add an item. Adjust quantities anytime.</p>
                    </div>
                    <button
                      type="button"
                      className="modal-close"
                      aria-label="Close add items popup"
                      onClick={() => setIsAddItemsOpen(false)}
                    >
                      ×
                    </button>
                  </div>
                  <label className="modal-search">
                    Search groceries
                    <input
                      autoFocus
                      placeholder="Try milk, bread, apples…"
                      value={modalSearch}
                      onChange={(event) => setModalSearch(event.target.value)}
                    />
                  </label>
                  <div className="modal-products">
                    {catalog.products
                      .filter((product) =>
                        (product.name + " " + product.category)
                          .toLowerCase()
                          .includes(modalSearch.trim().toLowerCase()),
                      )
                      .map((product) => {
                        const item = basket.find((entry) => entry.productId === product.id);
                        const itemQuantity = item?.quantity ?? 0;
                        return (
                          <article key={product.id} className={itemQuantity ? "product added" : "product"}>
                            <span className="emoji"><SketchIcon name={foodIcon(product.name)} size={32} /></span>
                            <div className="modal-product-copy">
                              <h3>{product.name}</h3>
                              <small>{product.unit}</small>
                            </div>
                            <button
                              type="button"
                              className="modal-add-button"
                              onClick={() => quantity(product.id, 1)}
                              disabled={itemQuantity === 99}
                              aria-label={`Add one ${product.name}`}
                            >
                              {itemQuantity ? `${itemQuantity} +` : "＋"}
                            </button>
                          </article>
                        );
                      })}
                    {!catalog.products.some((product) =>
                      (product.name + " " + product.category)
                        .toLowerCase()
                        .includes(modalSearch.trim().toLowerCase()),
                    ) && <p className="modal-no-results">No groceries match that search yet.</p>}
                  </div>
                  <div className="add-items-modal-footer">
                    <span>{basket.length} {basket.length === 1 ? "item" : "items"} in your list</span>
                    <button type="button" className="add-items-done" onClick={() => setIsAddItemsOpen(false)}>
                      DONE
                    </button>
                  </div>
                </section>
              </div>
            )}
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
          </section>
        )}
      </main>
    </div>
  );
}
