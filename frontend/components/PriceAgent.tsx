"use client";
import StoreColumns from "./StoreColumns";
import MultiStorePlanner from "./MultiStorePlanner";
import ProductImage from "./ProductImage";
import SketchIcon from "./SketchIcon";
import { useState, useEffect, useRef } from "react";
import type { AgentItem, StoreCheck } from "@/lib/price-agent";
import {
  reviewedTotal,
  ownedCandidate,
  pricedItemCount,
} from "@/lib/price-agent";
import type { SearchOrigin } from "@/lib/locations";
import type { StoreCoverage } from "@/lib/retailer-coverage";
import { groceryCoverage } from "@/lib/retailer-coverage";
import type { NearbyPlace } from "@/lib/live-data";
import type { ScrapeReport } from "@/lib/retailer-scraper";
import { mergeCatalogReports } from "@/lib/merge-catalog-reports";
import { centers } from "@/lib/locations";
import type { GasStop } from "@/lib/gas-stop";
import { fuelCostCents } from "@/lib/live-trip";
import { normalizedUnitPrice } from "@/lib/package-match";
import { addCartLine, cartLine, readCart, readCartOptions, writeCart, writeCartOptions, SMART_CART_EVENT } from "@/lib/smart-cart";
import { readCatalogPicks, writeCatalogPicks } from "@/lib/catalog-picks";
import { packageMatches } from "@/lib/package-match";
import { nearbyAlternatives } from "@/lib/nearby-alternatives";
import {
  SearchEpoch,
  searchStatusLabel,
  settlePendingReports,
} from "@/lib/search-state";
import { normalizeCatalogReport } from "@/lib/product-ownership";
import { SEARCH_CLIENT_TIMEOUT_MS } from "@/lib/search-timing";
import {
  hasVisibleBranchPrice,
  hasVisibleCatalogPrice,
} from "@/lib/visible-price-results";

function upsertReport(reports: ScrapeReport[], report: ScrapeReport, items: AgentItem[]) {
  const normalized = normalizeCatalogReport(report, items);
  const index = reports.findIndex((entry) => entry.retailer === normalized.retailer);
  if (index < 0) return [...reports, normalized];
  const next = [...reports];
  next[index] = normalizeCatalogReport(mergeCatalogReports(next[index], normalized), items);
  return next;
}

export default function PriceAgent({
  items,
  zip,
  area,
  origin,
  gasStop,
  gasPrice,
  gasPriceReported,
  gasEconomics,
  mpg,
  maxStops,
  minExtraStopSavings,
  shoppingPriority,
  nearbyPlaces,
  radius,
  autoStart = false,
  onSelectTrip,
}: {
  items: AgentItem[];
  zip: string;
  area: "downtown" | "midtown" | "decatur";
  origin: SearchOrigin | null;
  gasStop?: GasStop | null;
  gasPrice: number;
  gasPriceReported: boolean;
  gasEconomics?: { gallonsNeeded: number; baselinePrice: number; stationPrice: number };
  mpg: number;
  maxStops: number;
  minExtraStopSavings: number;
  shoppingPriority: "balanced" | "lowest_cost" | "fewest_stops";
  nearbyPlaces: NearbyPlace[];
  radius: number;
  autoStart?: boolean;
  onSelectTrip?: (store: StoreCheck, selected: Record<string, string>, route: { miles: number; minutes: number }, storeLocation: { mapUrl: string; lat: number; lon: number }) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [cartMessage, setCartMessage] = useState("");
  const [comparisonView, setComparisonView] = useState<"table" | "cards">("table");
  const [comparedStores, setComparedStores] = useState<string[]>([]);
  const [result, setResult] = useState<{
    stores: StoreCheck[];
    publicCatalogs: ScrapeReport[];
    coverage: string;
    checkedAt: string;
    storeCoverage: StoreCoverage[];
    warnings: string[];
    foundStores: number;
    agent?: { aiConnected: boolean; mode: string; reviewedMatches?: number };
    search?: { elapsedMs: number; partial: boolean; timedOut: boolean; locationError?: string | null };
  } | null>(null);
  const [liveReports, setLiveReports] = useState<ScrapeReport[]>([]);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [agentStage, setAgentStage] = useState<
    "waiting" | "planning" | "ready" | "reviewing" | "reviewed" | "unavailable"
  >("waiting");
  const [choices, setChoices] = useState<
    Record<string, Record<string, string>>
  >({});
  const [driving, setDriving] = useState<{
    key: string;
    routes: Record<string, { miles: number; minutes: number }>;
  }>({ key: "", routes: {} });
  const [routeBusy, setRouteBusy] = useState(false);
  const started = useRef(false);
  const epoch = useRef(new SearchEpoch());
  const requestController = useRef<AbortController | null>(null);
  const providerController = useRef<AbortController | null>(null);
  const inputKey = JSON.stringify([
    zip,
    area,
    origin?.lat,
    origin?.lon,
    radius,
    items.map((item) => [item.id, item.name, item.unit, item.quantity]),
  ]);
  const previousInput = useRef(inputKey);
  useEffect(() => {
    const mapped = groceryCoverage(nearbyPlaces);
    if (!mapped.length) return;
    setResult((previous) => previous && !previous.storeCoverage.length
      ? {
          ...previous,
          storeCoverage: mapped,
          foundStores: mapped.length,
          coverage: `Mapped ${mapped.length} nearby grocery locations within ${radius} miles. Product prices are only shown when a connected source returns them.`,
        }
      : previous);
  }, [nearbyPlaces, radius, result?.storeCoverage.length]);
  useEffect(() => {
    if (previousInput.current === inputKey) return;
    previousInput.current = inputKey;
    requestController.current?.abort();
    providerController.current?.abort();
    epoch.current.cancel();
    setBusy(false);
    setSourcesBusy(false);
    setSourceError("");
    setResult(null);
    setLiveReports([]);
    setChoices({});
  }, [inputKey]);
  useEffect(
    () => () => {
      requestController.current?.abort();
      providerController.current?.abort();
      epoch.current.cancel();
    },
    [],
  );
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void check();
    }
    // React replays effects in development. Its cleanup aborts the first request,
    // so the next setup must start a replacement instead of leaving a busy screen.
    return () => { started.current = false; };
  }, [autoStart]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("coverage");
  const [phase, setPhase] = useState(0);
  const routeKey = JSON.stringify([result?.checkedAt, origin?.lat, origin?.lon, area,
    gasStop?.id, gasStop?.lat, gasStop?.lon]);
  useEffect(() => {
    if (!result?.stores.length) return;
    const controller = new AbortController();
    const home = origin ?? centers[area];
    setDriving({ key: routeKey, routes: {} });
    setRouteBusy(true);
    void Promise.all(
      result.stores.map(async (store) => {
        const mapped = result.storeCoverage.find((row) => row.id === store.id);
        if (
          !mapped ||
          !Number.isFinite(mapped.lat) ||
          !Number.isFinite(mapped.lon)
        )
          return;
        try {
          const response = await fetch("/api/routes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              points: [
                home,
                { lat: mapped.lat, lon: mapped.lon },
                ...(gasStop ? [{ lat: gasStop.lat, lon: gasStop.lon }] : []),
                home,
              ],
            }),
            signal: controller.signal,
          });
          if (!response.ok) return;
          const route = await response.json();
          if (
            Number.isFinite(route.miles) &&
            Number.isFinite(route.minutes) &&
            !controller.signal.aborted
          )
            setDriving((previous) => previous.key === routeKey ? ({
              key: routeKey,
              routes: { ...previous.routes, [store.id]: { miles: route.miles, minutes: route.minutes } },
            }) : previous);
        } catch {
          /* An unavailable route cannot produce a trip total. */
        }
      }),
    ).finally(() => {
      if (!controller.signal.aborted) setRouteBusy(false);
    });
    return () => controller.abort();
  }, [result?.stores, result?.storeCoverage, origin, area, gasStop, routeKey]);
  useEffect(() => {
    if (!busy) return;
    setPhase(0);
    const timer = setInterval(() => setPhase((p) => Math.min(p + 1, 2)), 4000);
    return () => clearInterval(timer);
  }, [busy]);
  async function check() {
    requestController.current?.abort();
    providerController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    const requestId = epoch.current.begin();
    setBusy(true);
    setSourcesBusy(false);
    setSourceError("");
    setError("");
    setResult(null);
    setLiveReports([]);
    setAgentStage("waiting");
    setChoices({});
    let initialComplete = false;
    try {
      const response = await fetch("/api/agent/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zip,
          items,
          area,
          origin: origin ?? undefined,
          radius,
        }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(SEARCH_CLIENT_TIMEOUT_MS),
        ]),
      });
      if (!epoch.current.isCurrent(requestId)) return;
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Website search did not return a stream.");
      const decoder = new TextDecoder();
      let pending = "";
      try {
        for (;;) {
          const chunk = await reader.read();
          if (!epoch.current.isCurrent(requestId)) break;
          pending += decoder.decode(chunk.value, { stream: !chunk.done });
          const messages = pending.split("\n");
          pending = messages.pop() ?? "";
          for (const message of messages) {
            if (!message.trim()) continue;
            const event = JSON.parse(message);
            if (event.type === "error") throw new Error(event.error);
            if (!epoch.current.isCurrent(requestId)) break;
            if (event.type === "agent") {
              setAgentStage(event.stage);
              if (event.stage === "ready" || event.stage === "unavailable")
                setResult((previous) => previous && epoch.current.isCurrent(requestId)
                  ? {
                      ...previous,
                      agent: {
                        ...previous.agent,
                        aiConnected: event.stage === "ready",
                        mode: event.stage === "ready"
                          ? `${event.provider === "openai" ? "OpenAI" : "Local AI"} planned product searches using ${event.model}; prices still come from validated retailer pages.`
                          : "AI planning timed out; connected price sources are still loading.",
                      },
                    }
                  : previous);
            }
            if (event.type === "report")
              setLiveReports((previous) =>
                epoch.current.isCurrent(requestId)
                  ? upsertReport(previous, event.report, items)
                  : previous,
              );
            if (event.type === "complete") {
              initialComplete = true;
              setLiveReports([]);
              setResult((previous) =>
                epoch.current.isCurrent(requestId) ? event.result : previous,
              );
              setBusy(false);
              setSourcesBusy(false);
            }
            if (event.type === "catalog-review")
              setResult((previous) => previous && epoch.current.isCurrent(requestId)
                ? {
                    ...previous,
                    publicCatalogs: event.reports,
                    agent: previous.agent
                      ? { ...previous.agent, reviewedMatches: event.reviewedMatches }
                      : previous.agent,
                  }
                : previous);
            if (event.type === "sources-complete") {
              setBusy(false);
              setSourcesBusy(false);
            }
            if (event.type === "sources-error") {
              setSourcesBusy(false);
              setSourceError(event.error);
            }
          }
          if (chunk.done) break;
        }
      } finally {
        if (controller.signal.aborted)
          await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (e) {
      if (epoch.current.isCurrent(requestId)) {
        const timeout = e instanceof Error && e.name === "TimeoutError";
        setLiveReports((previous) =>
          epoch.current.isCurrent(requestId)
            ? settlePendingReports(previous, timeout ? "timeout" : "error")
            : previous,
        );
        const message = timeout
          ? "The search window ended. Any prices already found are kept. Search again to check slower sources."
          : e instanceof Error ? e.message : "Price check unavailable.";
        if (initialComplete) setSourceError(message);
        else setError(message);
      }
    } finally {
      if (epoch.current.isCurrent(requestId)) {
        setBusy(false);
        setSourcesBusy(false);
      }
    }
  }
  async function refreshProvider(retailer?: string, retry = false) {
    if (!result || busy || sourcesBusy) return;
    providerController.current?.abort();
    const controller = new AbortController();
    providerController.current = controller;
    const requestId = epoch.current.begin();
    setSourcesBusy(true);
    setSourceError("");
    try {
      const response = await fetch("/api/live/provider-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zip,
          items,
          retailers: retailer
            ? [retailer]
            : [...new Set(result.storeCoverage.map((s) => s.retailer))],
          start: retry,
          broaden: false,
          stream: true,
        }),
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(SEARCH_CLIENT_TIMEOUT_MS),
        ]),
      });
      if (!epoch.current.isCurrent(requestId)) return;
      if (!response.ok) throw new Error("Could not refresh provider prices.");
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Price refresh did not return a stream.");
      const decoder = new TextDecoder();
      let pending = "";
      try {
        for (;;) {
          const chunk = await reader.read();
          if (!epoch.current.isCurrent(requestId)) break;
          pending += decoder.decode(chunk.value, { stream: !chunk.done });
          const messages = pending.split("\n");
          pending = messages.pop() ?? "";
          for (const message of messages) {
            if (!message.trim()) continue;
            const event = JSON.parse(message);
            if (event.type === "error") throw new Error(event.error);
            if (event.type === "report")
              setLiveReports((previous) => epoch.current.isCurrent(requestId)
                ? upsertReport(previous, event.report, items)
                : previous);
            if (event.type === "complete") {
              setLiveReports((previous) => epoch.current.isCurrent(requestId)
                ? settlePendingReports((event.reports ?? []).reduce(
                    (reports: ScrapeReport[], report: ScrapeReport) => upsertReport(reports, report, items), previous), "timeout")
                : previous);
              setSourcesBusy(false);
            }
          }
          if (chunk.done) break;
        }
      } finally {
        if (controller.signal.aborted) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (e) {
      if (epoch.current.isCurrent(requestId)) {
        setLiveReports((previous) => settlePendingReports(
          previous,
          e instanceof Error && e.name === "TimeoutError" ? "timeout" : "error",
        ));
        setSourceError(e instanceof Error ? e.message : "Refresh failed.");
      }
    } finally {
      if (epoch.current.isCurrent(requestId)) setSourcesBusy(false);
    }
  }
  const totals =
    result?.stores
      .map((s) => reviewedTotal(s, choices[s.id] ?? {}))
      .filter((n): n is number => n !== null) ?? [];
  const canReviewStore = (store: StoreCheck) => store.lines.every((line) => {
    const selected = line.candidates.find((candidate) => candidate.id === choices[store.id]?.[line.item.id]);
    return selected && ownedCandidate(store, selected) && (!selected.productUrl || /^https:\/\//i.test(selected.productUrl));
  });
  const completeTrips =
    result?.stores.flatMap((store) => {
      if (store.lines.length !== items.length) return [];
      const groceryCents = reviewedTotal(store, choices[store.id] ?? {});
      const route = driving.key === routeKey ? driving.routes[store.id] : undefined;
      const fuelCents = route
        ? fuelCostCents(route.miles, mpg, gasPrice)
        : null;
      return groceryCents !== null && fuelCents !== null && route
        ? [
            {
              id: store.id,
              name: store.name,
              groceryCents,
              fuelCents,
              totalCents: groceryCents + fuelCents,
              ...route,
            },
          ]
        : [];
    }) ?? [];
  const cheapestTrip = completeTrips.length
    ? Math.min(...completeTrips.map((trip) => trip.totalCents))
    : null;
  const alternatives = nearbyAlternatives(result?.stores ?? [], choices);
  const catalogReports = result
    ? liveReports.reduce(
        (reports, report) => upsertReport(reports, report, items),
        result.publicCatalogs,
      )
    : [];
  const visibleCatalogs = catalogReports.filter(hasVisibleCatalogPrice);
  const visibleBranches = result?.stores.filter(hasVisibleBranchPrice) ?? [];
  function addVerifiedProduct(item: AgentItem, store: StoreCheck, location: StoreCoverage, productId: string) {
    const product = store.lines.find((line) => line.item.id === item.id)?.candidates.find((entry) => entry.id === productId);
    const line = product && cartLine(item, product, store, location);
    if (!line) { setCartMessage("This product needs a matching branch price and package before it can be added."); return; }
    const options = (result?.stores ?? []).flatMap((candidateStore) => {
      const candidateLocation = result?.storeCoverage.find((entry) => entry.id === candidateStore.id);
      const candidateLine = candidateStore.lines.find((entry) => entry.item.id === item.id);
      return candidateLocation ? (candidateLine?.candidates ?? []).flatMap((candidate) => {
        const option = cartLine(item, candidate, candidateStore, candidateLocation);
        return option ? [option] : [];
      }) : [];
    });
    const existing = readCartOptions(localStorage).filter((option) => option.item.id !== item.id);
    writeCartOptions(localStorage, [...existing, ...options].slice(0, 200));
    const next = addCartLine(readCart(localStorage), line);
    if (!writeCart(localStorage, next)) { setCartMessage("This item could not be saved to your cart."); return; }
    writeCatalogPicks(localStorage, readCatalogPicks(localStorage).filter((pick) => pick.itemId !== item.id));
    window.dispatchEvent(new Event(SMART_CART_EVENT));
    setCartMessage(`${item.name} added to Smart Cart.`);
  }
  const completeBranchCount = result?.stores.filter(
    (store) => pricedItemCount(store) === items.length,
  ).length ?? 0;
  return (
    <section
      className="live-sources search-workspace"
      aria-label="Basket price agent"
    >
      {!result && liveReports.some(hasVisibleCatalogPrice) && (
        <StoreColumns reports={liveReports.filter(hasVisibleCatalogPrice)} items={items} />
      )}
      <p className="eyebrow">PRICE COMPARISON</p>
      <h2>Available store prices</h2>
      <button
        className="cta"
        onClick={check}
        disabled={busy || !items.length || items.length > 30}
      >
        {busy ? "SEARCH IN PROGRESS…" : result ? "SEARCH AGAIN ↗" : "SEARCH STORES & PRICES ↗"}
      </button>
      {(busy || sourcesBusy) && (
        <button
          type="button"
          onClick={() => {
            requestController.current?.abort();
            providerController.current?.abort();
            epoch.current.cancel();
            setBusy(false);
            setSourcesBusy(false);
            setLiveReports([]);
            setError("Search canceled. You can retry when ready.");
          }}
        >
          Cancel search
        </button>
      )}
      <p className="small">
        Prices may change at checkout. Trip totals exclude tax and unconfirmed stock.
      </p>
      {error && <p role="alert">{error}</p>}
      {cartMessage && <p role="status">{cartMessage} <a href="/cart">Open Smart Cart ↗</a></p>}
      {busy && (
        <div className="search-progress" role="status" aria-live="polite">
          <SketchIcon name="cart" size={34} className="sketch-state-icon" />
          {agentStage === "planning"
            ? "AI is planning food searches…"
            : agentStage === "ready"
              ? "AI search plan ready. Checking retailer pages…"
              : agentStage === "reviewing"
                ? "AI is reviewing product matches…"
                : agentStage === "unavailable"
                  ? "AI planning unavailable or timed out. Checking connected websites…"
                  : [
                      "Finding stores and connected sources…",
                      "Searching products and checking packages…",
                      "Preparing the first comparison…",
                    ][phase]}
          <small>Prices appear as sources respond. You can cancel at any time.</small>
        </div>
      )}
      {result && sourcesBusy && (
        <p role="status" aria-live="polite" className="small">
          Checking for new prices. Your current results stay available.
        </p>
      )}
      {result?.search && !sourcesBusy && (
        <p role="status" className="small">
          {result.search.locationError
            ? "Nearby store lookup failed, so a local price comparison could not finish."
            : `Search finished in ${(result.search.elapsedMs / 1000).toFixed(1)} seconds.${result.search.partial
              ? " Some stores haven’t returned prices. You can check again." : " Results are below."}`}
        </p>
      )}
      {result?.search?.locationError && <p role="alert" className="small">{result.search.locationError}</p>}
      {sourceError && <p role="alert" className="small">{sourceError}</p>}
      {result && (
        <>
          {result.agent && (
            <details className="small"><summary>Search details</summary><p>
              {result.agent.mode}
              {result.agent.aiConnected && result.agent.reviewedMatches
                ? ` AI reviewed ${result.agent.reviewedMatches} product matches.`
                : ""}
            </p></details>
          )}
          {(visibleCatalogs.length + visibleBranches.length > 1 || query) && <div className="search-controls">
            <label className="result-search">
              <span>Search results</span>
              <input
                type="search"
                placeholder="Store, product, or brand…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <label>
              Order by
              <select value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="coverage">Price coverage</option>
                <option value="name">Store name</option>
              </select>
            </label>
          </div>}
          <details className="small"><summary>Store coverage</summary><p>{result.coverage}</p></details>
          {result.warnings.map((w) => (
            <p role="alert" key={w}>
              {w}
            </p>
          ))}
          <p className="small">
            {completeBranchCount
              ? `${completeBranchCount} nearby ${completeBranchCount === 1 ? "store has" : "stores have"} a complete priced basket.`
              : "No nearby store has a complete verified basket yet."}
            {visibleCatalogs.length
              ? ` ${visibleCatalogs.length} online ${visibleCatalogs.length === 1 ? "catalog" : "catalogs"} available for reference.`
              : ""}{" "}
            Checked {new Date(result.checkedAt).toLocaleString()}.
          </p>
          <p className="small" role="status">
            {visibleBranches.length
              ? "To add groceries: open a verified branch below, review a matching package, then choose Add to Smart Cart."
              : <>You can save products from the online catalogs below to Smart Cart now. Only verified store prices count toward the trip total. <a href="/cart/demo">Try the sample walkthrough ↗</a></>}
          </p>
          {(completeTrips.length > 0 || (completeBranchCount > 0 && routeBusy)) && <div
            className="live-card"
            aria-label="Verified grocery trip comparison"
          >
            <h3>Complete trips · groceries + driving</h3>
            {gasStop && (
              <p>Route includes {gasStop.name} after the grocery stop.</p>
            )}
            <p className="small">
              Fuel: {mpg} MPG · ${gasPrice.toFixed(2)}/gal (
              {gasPriceReported ? "reported station price" : "entered estimate"}
              ). Tax and stock are not verified.
            </p>
            {routeBusy && <p>Calculating driving routes…</p>}
            {completeTrips
              .sort((a, b) => a.totalCents - b.totalCents)
              .map((trip) => (
                <div key={trip.id} className="trip-option">
                  <strong>
                    {trip.name}
                    {trip.totalCents === cheapestTrip
                      ? " · lowest complete trip"
                      : ""}
                  </strong>{" "}
                  · groceries ${(trip.groceryCents / 100).toFixed(2)} + driving
                  ${(trip.fuelCents / 100).toFixed(2)} ={" "}
                  <strong>${(trip.totalCents / 100).toFixed(2)}</strong> ·{" "}
                  {trip.miles.toFixed(1)} mi, {trip.minutes} min
                  {gasStop && onSelectTrip && result.stores.some((store) => store.id === trip.id && canReviewStore(store)) && (
                    <button type="button" className="cta" disabled={routeBusy || driving.key !== routeKey}
                      onClick={() => {
                        const store = result.stores.find((entry) => entry.id === trip.id);
                        const route = driving.routes[trip.id];
                        const location = result.storeCoverage.find((entry) => entry.id === trip.id);
                        if (store && route && location && driving.key === routeKey) onSelectTrip(store, choices[store.id] ?? {}, route, location);
                      }}>
                      REVIEW THIS TRIP ↗
                    </button>
                  )}
                </div>
              ))}
          </div>}
          {!gasStop && completeBranchCount > 0 && <p>Choose a gas station on the map to calculate the full trip.</p>}
          {!!visibleCatalogs.length && (
            <StoreColumns
              items={items}
              onRetry={(retailerId) =>
                void (["Lidl", "Trader Joe’s"].includes(retailerId)
                  ? check()
                  : refreshProvider(retailerId, true))
              }
              reports={visibleCatalogs
                .filter((report) =>
                  `${report.retailer} ${report.lines.map((l) => l.item.name).join(" ")}`
                    .toLowerCase()
                    .includes(query.toLowerCase()),
                )
                .sort((a, b) =>
                  sort === "name"
                    ? a.retailer.localeCompare(b.retailer)
                    : Number(b.status === "retrieved") -
                        Number(a.status === "retrieved") ||
                      a.retailer.localeCompare(b.retailer),
                )}
            />
          )}
          {visibleBranches.length > 0 && <>
            <div className="comparison-toolbar"><strong>Compare verified branches</strong><div><button aria-pressed={comparisonView === "table"} onClick={() => setComparisonView("table")}>Table</button><button aria-pressed={comparisonView === "cards"} onClick={() => setComparisonView("cards")}>Cards</button></div></div>
            {comparisonView === "table" && <table className="comparison-table"><caption className="small">Select stores to focus the product breakdown below. Totals require reviewed packages and a route.</caption><thead><tr><th>Store</th><th>Coverage</th><th>Groceries</th><th>Drive / fuel</th><th>Trip total</th></tr></thead><tbody>{visibleBranches.map((store) => {
              const trip = completeTrips.find((entry) => entry.id === store.id);
              const total = reviewedTotal(store, choices[store.id] ?? {});
              return <tr key={store.id} className={trip && trip.totalCents === cheapestTrip ? "best" : ""}><td><label><input type="checkbox" checked={comparedStores.includes(store.id)} onChange={(event) => setComparedStores((old) => event.target.checked ? [...old, store.id] : old.filter((id) => id !== store.id))} /> {store.name}</label><small>{store.address}</small></td><td>{pricedItemCount(store)} / {items.length}<small>items priced</small></td><td>{total === null ? "Review items" : `$${(total / 100).toFixed(2)}`}</td><td>{trip ? <>{trip.miles.toFixed(1)} mi<small>${(trip.fuelCents / 100).toFixed(2)} fuel</small></> : "Awaiting route"}</td><td>{trip ? `$${(trip.totalCents / 100).toFixed(2)}` : "Incomplete"}</td></tr>;
            })}</tbody></table>}
            {comparedStores.length > 0 && <button className="text-button" onClick={() => setComparedStores([])}>Show all branches</button>}
          </>}
          {visibleBranches.length >= 2 && <MultiStorePlanner items={items} stores={visibleBranches} locations={result.storeCoverage}
            origin={origin} area={area} gasStop={gasStop} mpg={mpg} gasPrice={gasPrice} gasEconomics={gasEconomics} maxStores={maxStops}
            minExtraStopSavings={minExtraStopSavings} shoppingPriority={shoppingPriority} />
          }
          <div className={`live-grid ${comparisonView === "table" ? "branch-table-mode" : ""}`}>
            {visibleBranches.filter((store) => !comparedStores.length || comparedStores.includes(store.id)).map((store) => {
              const location = result.storeCoverage.find((entry) => entry.id === store.id)!;
              const total = store
                ? reviewedTotal(store, choices[store.id] ?? {})
                : null;
              const pricedCount = store ? pricedItemCount(store) : 0;
              return (
                <article className="live-card" key={location.id}>
                  <h3>{location.name}</h3>
                  <p>
                    {location.address ||
                      "Exact street address not supplied by map source"}
                    {Number.isFinite(location.miles) && ` · ${location.miles.toFixed(1)} miles away`}
                  </p>
                  <p>
                    <strong>
                      {pricedCount} of {items.length} items priced
                    </strong>{" "}
                    ·{" "}
                    {location.status === "checked"
                      ? "Branch source checked"
                      : location.status === "failed"
                        ? "Search failed"
                        : "Live pricing unavailable"}
                  </p>
                  {location.status === "failed" && (
                    <button type="button" onClick={() => void check()}>
                      Retry search
                    </button>
                  )}
                  <details className="branch-details" open={comparisonView === "cards" ? true : undefined}><summary>Review products & price sources</summary>
                  {items.map((item) => {
                    const line = store?.lines.find(
                      (entry) => entry.item.id === item.id,
                    );
                    const products = store
                      ? (line?.candidates ?? []).filter((candidate) =>
                          ownedCandidate(store, candidate),
                        )
                      : [];
                    const selected = products.find(
                      (candidate) =>
                        candidate.id === choices[store!.id]?.[item.id],
                    );
                    const preview = selected ?? products[0];
                    return (
                      <label
                        key={item.id}
                        style={{ display: "block", marginBottom: 16 }}
                      >
                        {item.quantity} × {item.name} · requested {item.unit}
                        {preview && <div className="branch-product-preview">
                          <ProductImage key={preview.id} className="branch-product-photo" name={preview.name}
                            brand={preview.brand} size={preview.size} upc={preview.upc}
                            retailerImageUrl={preview.imageUrl} retailerSourceUrl={preview.productUrl ?? undefined} />
                          <div><strong>{preview.name}</strong><small>{preview.brand ? `${preview.brand} · ` : ""}{preview.size} · {preview.soldBy === "WEIGHT" ? "advertised per-pound rate" : "advertised each price"}</small>
                            <small>${(preview.price ?? 0).toFixed(2)} · {preview.matchKind === "comparable" ? "Comparable item · review before choosing" : "Matching item"}</small>
                            <small>{preview.priceSource} · checked {new Date(preview.verifiedAt).toLocaleString()}</small>
                            {preview.productUrl && <a href={preview.productUrl} target="_blank" rel="noreferrer">View retailer offer ↗</a>}</div>
                        </div>}
                        {products.length ? (
                          <select
                            aria-label={`${location.name}: ${item.name}`}
                            value={choices[store!.id]?.[item.id] ?? ""}
                            onChange={(e) =>
                              setChoices((c) => ({
                                ...c,
                                [store!.id]: {
                                  ...c[store!.id],
                                  [item.id]: e.target.value,
                                },
                              }))
                            }
                          >
                            <option value="">Review a matching package</option>
                            {products.map((p) => (
                              <option
                                key={p.id}
                                value={p.id}
                                disabled={
                                  !p.regularCents ||
                                  p.soldBy !== "UNIT" ||
                                  !packageMatches(item.unit, p.size)
                                }
                              >
                                {p.name} · {p.size} ·{" "}
                                {p.regularCents
                                  ? `$${(p.regularCents / 100).toFixed(2)}`
                                  : "Price unknown"}{" "}
                                {p.regularCents &&
                                normalizedUnitPrice(p.regularCents, p.size)
                                  ? `· $${(normalizedUnitPrice(p.regularCents, p.size)!.displayCents / 100).toFixed(2)}/${normalizedUnitPrice(p.regularCents, p.size)!.displayUnit} `
                                  : ""}
                                · {p.soldBy}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span>
                            {" "}
                            ·{" "}
                            {location.status === "unavailable"
                              ? "Live pricing unavailable"
                              : line?.error ||
                                searchStatusLabel(
                                  line?.searchStatus ?? "no_results",
                                )}
                          </span>
                        )}
                        {selected && (
                          <p className="small">
                            {selected.priceSource} · updated{" "}
                            {new Date(selected.verifiedAt).toLocaleString()}
                            {selected.productUrl ? (
                              <>
                                {" "}
                                ·{" "}
                                <a
                                  href={selected.productUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Product ↗
                                </a>
                              </>
                            ) : (
                              " · product URL not supplied by source"
                            )}
                          </p>
                        )}
                        {selected && <button type="button" disabled={!cartLine(item, selected, store, location)}
                          onClick={() => addVerifiedProduct(item, store, location, selected.id)}>Add to Smart Cart</button>}
                      </label>
                    );
                  })}
                  </details>
                  <strong>
                    {total === null
                      ? "Incomplete basket — missing or unreviewed prices"
                      : `Reviewed groceries: $${(total / 100).toFixed(2)}`}
                  </strong>
                  {total !== null && !canReviewStore(store) && <p className="small">A selected product could not be verified for this branch.</p>}
                  {total !== null &&
                    totals.length >= 2 &&
                    total === Math.min(...totals) && (
                      <p>
                        Lowest reviewed grocery subtotal among these complete
                        baskets. Compare travel before choosing a trip.
                      </p>
                    )}
                  {total !== null && gasStop && onSelectTrip && canReviewStore(store) && driving.key === routeKey && driving.routes[store.id] && (
                    <button type="button" className="cta" disabled={routeBusy}
                      onClick={() => onSelectTrip(store, choices[store.id] ?? {}, driving.routes[store.id], location)}>
                      REVIEW FOOD + GAS TOTAL ↗
                    </button>
                  )}
                </article>
              );
            })}
          </div>
          {alternatives.length > 0 && <section
            className="live-card"
            aria-label="Cheaper alternatives at nearby stores"
          >
            <h3>Cheaper alternatives at nearby stores</h3>
            {[
              ...new Map(
                alternatives.map((entry) => [
                  `${entry.store.retailerId}:${entry.store.id}`,
                  entry.store,
                ]),
              ).values(),
            ].map((store) => (
              <div key={`${store.retailerId}:${store.id}`}>
                <h4>{store.name}</h4>
                <p>
                  {store.address} · {store.retailerId}
                </p>
                {alternatives
                  .filter(
                    (entry) =>
                      entry.store.id === store.id &&
                      entry.store.retailerId === store.retailerId,
                  )
                  .map((entry) => (
                    <p key={`${entry.item.id}:${entry.product.productId}`}>
                      {entry.item.name}: {entry.product.productName} ·{" "}
                      {entry.product.size} · $
                      {(entry.product.regularCents! / 100).toFixed(2)} · save $
                      {(entry.savingsCents / 100).toFixed(2)} on this item ·{" "}
                      {entry.product.priceSource} · updated{" "}
                      {new Date(entry.product.verifiedAt).toLocaleString()}
                      {entry.product.productUrl && (
                        <>
                          {" "}
                          ·{" "}
                          <a
                            href={entry.product.productUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Product ↗
                          </a>
                        </>
                      )}
                    </p>
                  ))}
              </div>
            ))}
          </section>}
        </>
      )}
    </section>
  );
}
