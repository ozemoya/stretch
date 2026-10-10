"use client";
import { useEffect, useMemo, useState } from "react";
import type { BasketItem, Catalog, Preferences, Trip } from "@/lib/types";
import { optimize, suggestSwaps } from "@/lib/optimizer";
import LiveSources from "./LiveSources";
import { detectLocation } from "@/lib/detect-location";
import PriceAgent from "./PriceAgent";
import { centers, type SearchOrigin } from "@/lib/locations";
import type { FuelQuote } from "@/lib/live-data";
const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
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
function Route({ trip }: { trip?: Trip }) {
  return (
    <div
      className="route-illustration"
      aria-label={trip ? "Selected trip route" : "Illustrative two-stop route"}
    >
      <span className="hand route-note">
        a little detour.
        <br />a lot more dinner.
      </span>
      <svg viewBox="0 0 440 330" aria-hidden="true">
        <path d="M80 220 C35 120 110 50 200 60 S405 120 360 225 S175 330 80 220" />
        <path className="arrows" d="m200 60 15 5-10 12m145 235-15 2 3-15" />
      </svg>
      <span className="pin home">
        ⌂<small>HOME</small>
      </span>
      <span className="pin first">
        1<small>{trip?.stops[0]?.store.name ?? "MARKET A"}</small>
      </span>
      {(!trip || trip.stops.length > 1) && (
        <span className="pin second">
          2<small>{trip?.stops[1]?.store.name ?? "MARKET B"}</small>
        </span>
      )}
    </div>
  );
}
export default function Stretch({
  catalog,
  source,
  error,
}: {
  catalog: Catalog;
  source: "demo" | "supabase";
  error?: string;
}) {
  const [basket, setBasket] = useState<BasketItem[]>(
      [],
    ),
    [prefs, setPrefs] = useState(defaults),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [checked, setChecked] = useState<string[]>([]),
    [notice, setNotice] = useState(""),
    [showPlanner, setShowPlanner] = useState(true),
    [previousBasket, setPreviousBasket] = useState<BasketItem[] | null>(null);
  const [checkoutBasket,setCheckoutBasket] = useState<BasketItem[] | null>(null);
  const [checkoutBusy,setCheckoutBusy] = useState(false);
  const [checkoutRun,setCheckoutRun] = useState(0);
  async function checkout() {
    if (!basket.length || checkoutBusy) return;
    setCheckoutBusy(true);
    if (!searchOrigin) { setCheckoutBusy(false); return; }
    setCheckoutBasket(basket.map(item=>({...item})));
    setCheckoutRun(run=>run+1);
    setCheckoutBusy(false);
    setTimeout(()=>document.getElementById("checkout-results")?.scrollIntoView({behavior:"smooth"}),50);
  }
  const [fuelSource, setFuelSource] = useState<FuelQuote | null>(null);
  const [searchOrigin, setSearchOrigin] = useState<SearchOrigin | null>(null);
  const [ipArea,setIpArea] = useState(true);
  const [locationState,setLocationState] = useState("Detecting your IP area…");
  useEffect(()=>{
    const controller=new AbortController();
    detectLocation(controller.signal).then(origin=>{if(!controller.signal.aborted){setSearchOrigin(origin);setLocationState("Approximate location from your IP");}}).catch(()=>{if(!controller.signal.aborted)setLocationState("Could not detect your area. Choose a starting area below.");});
    return ()=>controller.abort();
  },[]);
  const calculation = useMemo(() => {
    try {
      return { trips: optimize(catalog, basket, prefs), error: "" };
    } catch (e) {
      return { trips: [], error: (e as Error).message };
    }
  }, [catalog, basket, prefs]);
  const complete = calculation.trips.filter((t) => !t.missing.length),
    best = complete[0],
    active = complete.find((t) => t.id === selected) ?? best;
  const swaps = useMemo(() => {
    try {
      return suggestSwaps(catalog, basket, prefs);
    } catch {
      return [];
    }
  }, [catalog, basket, prefs]);
  const singles = complete.filter((t) => t.stops.length === 1),
    extra =
      best && singles[0] && best.stops.length > 1
        ? singles[0].totalCents - best.totalCents
        : 0;
  function quantity(id: string, change: number) {
    setBasket((old) => {
      const q = Math.min(
        99,
        Math.max(
          0,
          (old.find((x) => x.productId === id)?.quantity ?? 0) + change,
        ),
      );
      return [
        ...old.filter((x) => x.productId !== id),
        ...(q ? [{ productId: id, quantity: q }] : []),
      ];
    });
    setChecked([]);
    setSelected(null);
  }
  function change<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    if (key === "gas") setFuelSource(null);
    setPrefs((old) => ({ ...old, [key]: value }));
    setChecked([]);
    setSelected(null);
  }
  function download() {
    if (!active) return;
    const body = [
      "STRETCH — SHOPPING PLAN",
      `Sample distances · ${active.miles} miles round trip`,
      `Groceries ${money(active.foodCents)} + fuel ${money(active.fuelCents)} = ${money(active.totalCents)}`,
      ...active.stops.flatMap((s) => [
        "",
        s.store.name,
        ...s.items.map(
          (i) =>
            `[ ] ${i.quantity} × ${i.name} (${i.unit}) — ${money(i.priceCents * i.quantity)}`,
        ),
      ]),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([body], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "stretch-shopping-plan.txt";
    a.click();
    URL.revokeObjectURL(url);
  }
  function plan() {
    setShowPlanner(true);
    setTimeout(
      () =>
        document
          .getElementById("planner")
          ?.scrollIntoView({ behavior: "smooth" }),
      0,
    );
  }
  return (
    <>
      <a className="skip" href="#planner">
        Skip to planner
      </a>
      <header>
        <nav>
          <button onClick={plan}>PLAN A TRIP</button>
          <a href="#how">HOW IT WORKS</a>
        </nav>
        <a href="#" aria-label="Stretch home">
          <img className="logo" src="/assets/stretch-logo.png" alt="Stretch" />
        </a>
        <nav>
          <a href="#story">OUR STORY</a>
          <button onClick={plan}>
            MY LIST ({basket.reduce((n, i) => n + i.quantity, 0)}) ↗
          </button>
        </nav>
      </header>
      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">MADE FOR EVERYDAY ATLANTA ADVENTURES</p>
            <h1>
              The little trip
              <br />
              that stretches
              <br />
              your budget.
            </h1>
            <p>
              Your list, a smarter route, and more left over.
              <br />
              Compare the groceries and the drive home.
            </p>
            <button className="cta" onClick={plan}>
              PLOT MY TRIP ↗
            </button>
          </div>
          <Route />
        </section>
        {checkoutBasket && <section className="compare">
          <div className="comparison-paper">
            <p className="eyebrow">SAME LIST. DIFFERENT TRIPS.</p>
            <h2>Find your sweet spot.</h2>
            <p className="source">
              {source === "supabase"
                ? "Catalog connected to Supabase"
                : "Demo catalog"}{" "}
              ·{" "}
              {catalog.offers.every((o) => o.isSample)
                ? "Fictional sample prices"
                : "Check individual price sources"}{" "}
              · illustrative distances
            </p>
            <p className="small">
              {fuelSource
                ? `Fuel estimate: ${fuelSource.stationName}, reported ${new Date(fuelSource.period).toLocaleString()}. Gas stop detour excluded.`
                : "Fuel estimate: manually entered gas price."}
            </p>
            {error && (
              <p role="status" className="alert">
                {error}
              </p>
            )}
            <div className="trip-cards">
              {complete.slice(0, 3).map((t, i) => (
                <button
                  key={t.id}
                  className={
                    "trip-card " + (active?.id === t.id ? "chosen" : "")
                  }
                  onClick={() => {
                    setSelected(t.id);
                    setShowPlanner(true);
                    setChecked([]);
                  }}
                  aria-pressed={active?.id === t.id}
                >
                  <span className="eyebrow">
                    {i === 0 ? "LOWEST TOTAL" : t.stops.length + " STOP OPTION"}
                  </span>
                  <h3>{t.stops.map((s) => s.store.name).join(" + ")}</h3>
                  <strong>{money(t.totalCents)}</strong>
                  <span>
                    Food {money(t.foodCents)} + fuel {money(t.fuelCents)}
                  </span>
                  <span>
                    {t.stops.length} stop{t.stops.length > 1 ? "s" : ""} ·{" "}
                    {t.miles} miles · ~{t.minutes} min
                  </span>
                  <b>
                    {t.totalCents <= prefs.budget * 100
                      ? money(prefs.budget * 100 - t.totalCents) +
                        " under budget"
                      : money(t.totalCents - prefs.budget * 100) +
                        " over budget"}
                  </b>
                </button>
              ))}
            </div>
            {!complete.length && (
              <p role="status">
                {calculation.error ||
                  (!basket.length
                    ? "Add items to your list to compare trips."
                    : "No complete trip matches this list. Review dietary conflicts or substitutions below.")}
              </p>
            )}
            {extra > 0 && (
              <p className="tradeoff">
                One extra stop saves {money(extra)} versus the cheapest single
                store. Your call.
              </p>
            )}
            <p className="small">
              Fuel includes the drive home. Time assumes 25 mph plus 12 minutes
              per stop; tax excluded.
            </p>
          </div>
          <button className="list-banner" onClick={plan}>
            YOUR NEXT GOOD TRIP STARTS WITH A LIST. <span>BUILD MY LIST ↗</span>
          </button>
        </section>}
        <section
          id="planner"
          className={"planner " + (!showPlanner ? "collapsed" : "")}
        >
          <div className="section-head">
            <div>
              <p className="eyebrow">LET’S MAKE THE NUMBERS WORK</p>
              <h2>First, pick your food.</h2>
            </div>
            <button
              className="text-button"
              onClick={() => setShowPlanner(!showPlanner)}
            >
              {showPlanner ? "Hide planner −" : "Open planner +"}
            </button>
          </div>
          {showPlanner && (
            <>
              <div className="settings">
                <label>
                  Starting area
                  <select
                    value={searchOrigin && ipArea ? "ip" : searchOrigin ? prefs.area : "pending"}
                    onChange={(e) => {
                      if(e.target.value === "ip" || e.target.value === "pending") return;
                      const area=e.target.value as Preferences["area"];
                      change("area",area);setIpArea(false);setSearchOrigin({...centers[area],label:area});setLocationState("Starting area selected manually");
                    }}
                  >
                    {!searchOrigin && <option value="pending">{locationState}</option>}
                    {searchOrigin && ipArea && <option value="ip">Current IP area: {searchOrigin.label}</option>}
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
                  Preferences flag incompatible items; swaps require your
                  approval.
                </span>
              </div>
              <p className="small">
                Dietary tags are sample data. Confirm ingredients and allergen
                labels before buying.
              </p>
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
                        setChecked([]);
                      }}
                    >
                      Clear list
                    </button>
                  </div>
                  <div className="products">
                    {!search.trim() && !basket.length && <p className="empty-list">Your grocery list is empty. Search for a food to add it.</p>}
                    {catalog.products
                      .filter((p) =>
                        search.trim() ? (p.name + " " + p.category)
                          .toLowerCase()
                          .includes(search.trim().toLowerCase()) : basket.some(item=>item.productId===p.id),
                      )
                      .map((p) => {
                        const q =
                          basket.find((i) => i.productId === p.id)?.quantity ??
                          0;
                        return (
                          <article
                            key={p.id}
                            className={q ? "product added" : "product"}
                          >
                            <span className="emoji">{p.emoji}</span>
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
                  <p className="eyebrow">STEP 1 · BUILD YOUR FOOD LIST</p>
                  <p>{basket.length} different foods selected. Checkout searches nearby groceries and gas stations.</p>
                  <button className="cta" disabled={!basket.length || !searchOrigin || checkoutBusy || basket.some(i=>i.quantity>20)} onClick={checkout}>{checkoutBusy ? "FINDING YOUR AREA…" : "CHECKOUT · FIND MY STOPS"}</button>
                  <p className="eyebrow">YOUR NEXT GOOD TRIP</p>
                  <h2>
                    {active ? money(active.totalCents) : "Let’s find a way."}
                  </h2>
                  {calculation.error && (
                    <p className="alert" role="alert">
                      {calculation.error}
                    </p>
                  )}
                  {active && (
                    <>
                      <p>
                        Home →{" "}
                        {active.stops.map((s) => s.store.name).join(" → ")} →
                        Home
                      </p>
                      <p>
                        {active.miles} round-trip miles · ~{active.minutes} min
                      </p>
                      <button className="cta" onClick={download}>
                        DOWNLOAD CHECKLIST ↓
                      </button>
                      {active.stops.map((s) => (
                        <div className="shopping-stop" key={s.store.id}>
                          <h3>{s.store.name}</h3>
                          {s.items.map((i) => {
                            const key = s.store.id + i.productId;
                            const stale =
                              Date.now() - Date.parse(i.recordedAt) >
                              7 * 86400000;
                            return (
                              <label key={key} className="check-item">
                                <input
                                  type="checkbox"
                                  checked={checked.includes(key)}
                                  onChange={(e) =>
                                    setChecked((old) =>
                                      e.target.checked
                                        ? [...old, key]
                                        : old.filter((x) => x !== key),
                                    )
                                  }
                                />
                                <span>
                                  {i.quantity} × {i.name}
                                  <small>
                                    {i.unit} ·{" "}
                                    {money(i.priceCents * i.quantity)}
                                    <br />
                                    {i.isSample ? "Sample" : "Recorded"}:{" "}
                                    {new Date(i.recordedAt).toLocaleDateString(
                                      "en-US",
                                      { timeZone: "UTC" },
                                    )}
                                    {stale ? " · older than 7 days" : ""}
                                  </small>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ))}
                    </>
                  )}
                  {swaps.length > 0 && (
                    <div className="swaps">
                      <h3>Make room in your budget.</h3>
                      {swaps.map((s) => (
                        <article key={s.fromId}>
                          <b>
                            {
                              catalog.products.find((p) => p.id === s.fromId)
                                ?.name
                            }{" "}
                            → {s.product.name}
                          </b>
                          <p>{s.note}</p>
                          <p>
                            {s.savings === null
                              ? "Resolves a dietary conflict"
                              : `Save ${money(s.savings)} on the whole trip`}
                          </p>
                          <button
                            onClick={() => {
                              setPreviousBasket(basket);
                              setBasket(s.updated);
                              setChecked([]);
                              setSelected(null);
                              setNotice(
                                "Swapped to " +
                                  s.product.name +
                                  ". You can undo it.",
                              );
                            }}
                          >
                            Use this swap
                          </button>
                        </article>
                      ))}
                    </div>
                  )}
                  {notice && (
                    <p role="status">
                      {notice}{" "}
                      <button
                        onClick={() => {
                          if (previousBasket) setBasket(previousBasket);
                          setPreviousBasket(null);
                          setChecked([]);
                          setNotice("Swap undone.");
                        }}
                      >
                        Undo swap
                      </button>
                    </p>
                  )}
                  {calculation.trips
                    .filter((t) => t.missing.length)
                    .map((t) => (
                      <details key={t.id}>
                        <summary>
                          {t.stops.map((s) => s.store.name).join(" + ")} —
                          incomplete
                        </summary>
                        <p>
                          Missing or incompatible: {t.missing.join(", ")}.
                          Excluded from cheapest-trip ranking.
                        </p>
                      </details>
                    ))}
                  <p className="small">
                    Locations and routes are illustrative. Live directions
                    aren’t available for fictional stores.
                  </p>
                </aside>
              </div>
            </>
          )}
        </section>
        {checkoutBasket && <div id="checkout-results">
        <p className="eyebrow">STEP 2 · YOUR STORES & GAS STOPS</p>
        <button type="button" onClick={plan}>Edit your food list</button>
        <PriceAgent
          autoStart
          key={JSON.stringify([checkoutRun, checkoutBasket, prefs.area])}
          zip={searchOrigin?.zip ?? centers[prefs.area].zip}
          area={prefs.area}
          origin={searchOrigin}
          items={checkoutBasket.map((item) => {
            const p = catalog.products.find((p) => p.id === item.productId)!;
            return {
              id: p.id,
              name: p.name,
              unit: p.unit,
              quantity: item.quantity,
            };
          })}
        />
        <LiveSources
          key={checkoutRun}
          autoLoad
          area={prefs.area}
          origin={searchOrigin}
          onOrigin={setSearchOrigin}
          onArea={(area) => change("area", area)}
          onFuel={(quote) => {
            change("gas", quote.dollarsPerGallon);
            setFuelSource(quote);
            setNotice(
              `Using ${quote.stationName}'s reported station price. Grocery prices and route distances are still sample data; a gas-station detour is not included.`,
            );
          }}
        />
        </div>}
        <section id="story" className="story">
          <div>
            <p className="eyebrow">FOOD + FUEL + A PLAN</p>
            <h2>
              Your budget called.
              <br />
              Go a little further.
            </h2>
            <p>
              Make the whole trip work for you. Choose one stop,
              <br />
              try a swap, or take the scenic savings.
            </p>
            <div className="steps">
              <span>
                <b>01</b>MAKE A LIST
              </span>
              <span>
                <b>02</b>COMPARE TRIPS
              </span>
              <span>
                <b>03</b>BRING IT HOME
              </span>
            </div>
            <button className="cta" onClick={plan}>
              TRY STRETCH ↗
            </button>
          </div>
          <div className="stripes">
            <div className="receipt">
              <p className="eyebrow">THE WHOLE TRIP</p>
              <strong>{active ? money(active.totalCents) : "Your plan"}</strong>
              {active && (
                <>
                  <p>
                    Groceries <b>{money(active.foodCents)}</b>
                  </p>
                  <p>
                    Fuel <b>{money(active.fuelCents)}</b>
                  </p>
                  <hr />
                  <p>
                    {active.stops.length} stops · {active.miles} miles
                  </p>
                </>
              )}
              <small>
                {source === "demo" ? "Demo" : "Supabase"} catalog · sample
                distances
              </small>
            </div>
            <p className="hand">
              More dinner.
              <br />
              Less detour doubt.
            </p>
          </div>
        </section>
        <section id="how" className="closing">
          <div>
            <p className="eyebrow">SMALL CHANGES. FULLER BASKETS.</p>
            <h2>Bring more home.</h2>
            <p>Start with your list. Leave with a plan.</p>
            <button className="cta" onClick={plan}>
              PLAN MY FIRST TRIP ↗
            </button>
          </div>
        </section>
      </main>
      <footer>
        STRETCH · HACKLANTA 2026 ·{" "}
        {source === "demo" ? "DEMO DATA" : "SUPABASE CATALOG"}
      </footer>
    </>
  );
}
