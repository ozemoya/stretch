"use client";
import StoreColumns from "./StoreColumns";
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
import type { ScrapeReport } from "@/lib/retailer-scraper";
import { mergeCatalogReports } from "@/lib/merge-catalog-reports";
import { centers } from "@/lib/locations";
import type { GasStop } from "@/lib/gas-stop";
import { fuelCostCents } from "@/lib/live-trip";
import { normalizedUnitPrice } from "@/lib/package-match";
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
  mpg,
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
  mpg: number;
  autoStart?: boolean;
  onSelectTrip?: (store: StoreCheck, selected: Record<string, string>, route: { miles: number; minutes: number }, storeLocation: { mapUrl: string; lat: number; lon: number }) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
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
    search?: { elapsedMs: number; partial: boolean; timedOut: boolean };
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
  const [radius, setRadius] = useState(5);
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
          ? "The five-second search window ended. Any verified prices already found are kept. You can search again to check slower sources."
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
      <div className="search-summary">
        <span>
          {items.length} {items.length === 1 ? "item" : "items"} in your list
        </span>
        <span>⌖ {origin?.label || zip}</span>
        <span>{radius} mile radius</span>
      </div>
      <p>
        Compare prices for your list, then choose a brand and package size.
        Check product labels for ingredients and allergens.
      </p>
      <button
        className="cta"
        onClick={check}
        disabled={busy || !items.length || items.length > 30}
      >
        {busy ? "SEARCH IN PROGRESS…" : "SEARCH STORES & PRICES ↗"}
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
      <label className="live-area">
        Store search radius
        <select
          value={radius}
          disabled={busy}
          onChange={(e) => {
            setRadius(Number(e.target.value));
            setResult(null);
            setChoices({});
          }}
        >
          {[1, 2, 3, 5, 10].map((r) => (
            <option key={r} value={r}>
              {r} mile{r === 1 ? "" : "s"}
            </option>
          ))}
        </select>
      </label>
      <p className="small">
        Some stores don’t share local prices. Online prices may differ in store.
        Trip totals include driving fuel but exclude tax; stock is not confirmed.
      </p>
      {error && <p role="alert">{error}</p>}
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
          <small>Up to five seconds. Verified prices appear as they arrive.</small>
        </div>
      )}
      {result && sourcesBusy && (
        <p role="status" aria-live="polite" className="small">
          Checking for new prices — up to five seconds. Your current results stay available.
        </p>
      )}
      {result?.search && !sourcesBusy && (
        <p role="status" className="small">
          Search finished in {(result.search.elapsedMs / 1000).toFixed(1)} seconds.
          {result.search.partial ? " Some stores haven’t returned prices. You can check again." : " Results are below."}
        </p>
      )}
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
          <div className="search-controls">
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
          </div>
          <details className="small"><summary>Store coverage</summary><p>{result.coverage}</p></details>
          {result.warnings.map((w) => (
            <p role="alert" key={w}>
              {w}
            </p>
          ))}
          <p>
            <strong>
              {
                result.stores.filter(
                  (store) => pricedItemCount(store) === items.length,
                ).length
              }{" "}
              / {result.foundStores ?? result.storeCoverage.length} locations
              have every item priced.
            </strong>{" "}
            Only complete reviewed baskets with a driving route can be ranked.
          </p>
          <p>
            <strong>
              Online prices found at {visibleCatalogs.length} retailers.
            </strong>{" "}
            Review these separately below.
          </p>
          {result.storeCoverage.length > visibleBranches.length && (
            <p className="small">
              Local prices aren’t available for {result.storeCoverage.length - visibleBranches.length} nearby stores.
            </p>
          )}
          <p className="small">
            Checked {new Date(result.checkedAt).toLocaleString()}. Prices can
            change at checkout.
          </p>
          <div
            className="live-card"
            aria-label="Verified grocery trip comparison"
          >
            <h3>Complete trips · groceries + driving</h3>
            <p>
              Choose a priced package for every food below. A trip appears here
              only when that exact branch has a complete priced basket and a
              driving route.
            </p>
            {gasStop && (
              <p>Route includes {gasStop.name} after the grocery stop.</p>
            )}
            <p className="small">
              Fuel: {mpg} MPG · ${gasPrice.toFixed(2)}/gal (
              {gasPriceReported ? "reported station price" : "entered estimate"}
              ). Tax and stock are not verified.
            </p>
            {routeBusy && <p>Calculating driving routes…</p>}
            {!routeBusy && !completeTrips.length && (
              <p>No complete branch-priced trip can be ranked yet.</p>
            )}
            {!gasStop && <p>Choose a specific gas station on the map to continue to trip review.</p>}
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
          </div>
          {!!(catalogReports.length || result.storeCoverage.length) && (
            <button
              type="button"
              disabled={busy || sourcesBusy}
              onClick={() => void refreshProvider()}
            >
              {sourcesBusy ? "Checking sources…" : "Check for new prices"}
            </button>
          )}
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
          {!result.stores.length && (
            <p>
              No branch-verified prices returned for these stores. Public
              catalog prices above are reference prices; local basket ranking
              remains unavailable.
            </p>
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
                    return (
                      <label
                        key={item.id}
                        style={{ display: "block", marginBottom: 16 }}
                      >
                        {item.quantity} × {item.name} · requested {item.unit}
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
          <section
            className="live-card"
            aria-label="Cheaper alternatives at nearby stores"
          >
            <h3>Cheaper alternatives at nearby stores</h3>
            {!alternatives.length && (
              <p>
                No cheaper branch-verified equivalent has been found for your
                selected products.
              </p>
            )}
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
          </section>
        </>
      )}
    </section>
  );
}
