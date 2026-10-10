"use client";
import StoreColumns from "./StoreColumns";
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
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<{
    stores: StoreCheck[];
    publicCatalogs: ScrapeReport[];
    coverage: string;
    checkedAt: string;
    storeCoverage: StoreCoverage[];
    warnings: string[];
    foundStores: number;
    agent?: { aiConnected: boolean; mode: string; reviewedMatches?: number };
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
  const [driving, setDriving] = useState<
    Record<string, { miles: number; minutes: number }>
  >({});
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
  }, [autoStart]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("coverage");
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    if (!result?.stores.length) return;
    const controller = new AbortController();
    const home = origin ?? centers[area];
    setDriving({});
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
            setDriving((previous) => ({
              ...previous,
              [store.id]: { miles: route.miles, minutes: route.minutes },
            }));
        } catch {
          /* An unavailable route cannot produce a trip total. */
        }
      }),
    ).finally(() => {
      if (!controller.signal.aborted) setRouteBusy(false);
    });
    return () => controller.abort();
  }, [result?.stores, result?.storeCoverage, origin, area, gasStop]);
  useEffect(() => {
    if (
      busy || sourcesBusy ||
      !liveReports.some(
        (report) =>
          report.status === "pending" ||
          report.lines.some((line) =>
            /Collection (?:running|starting)|Broader catalog search queued/i.test(
              line.error ?? "",
            ),
          ),
      )
    )
      return;
    const timer = setTimeout(() => void refreshProvider(), 20000);
    return () => clearTimeout(timer);
  }, [busy, sourcesBusy, result, liveReports]);
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
          AbortSignal.timeout(
            Math.min(
              240000,
              Math.max(
                5000,
                Number(process.env.NEXT_PUBLIC_STRETCH_SEARCH_TIMEOUT_MS) ||
                  120000,
              ),
            ),
          ),
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
              setSourcesBusy(true);
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
            if (event.type === "sources-complete") setSourcesBusy(false);
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
          ? initialComplete ? "Some retailer sources timed out. Prices already found are kept." : "Search timed out. Retry the search."
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
          AbortSignal.timeout(120000),
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
  const completeTrips =
    result?.stores.flatMap((store) => {
      if (store.lines.length !== items.length) return [];
      const groceryCents = reviewedTotal(store, choices[store.id] ?? {});
      const route = driving[store.id];
      const fuelCents = route
        ? fuelCostCents(route.miles, mpg, gasPrice)
        : null;
      return groceryCents !== null && fuelCents !== null
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
      <p className="eyebrow">YOUR LIST. EVERY POSSIBLE ROUTE.</p>
      <h2>Find your next best stop.</h2>
      <div className="search-summary">
        <span>
          {items.length} {items.length === 1 ? "item" : "items"} in your list
        </span>
        <span>⌖ {origin?.label || zip}</span>
        <span>{radius} mile radius</span>
      </div>
      <p>
        Search your entire list across supported stores, then confirm the brand
        and package you would actually buy. Dietary suitability must be checked
        on the product label.
      </p>
      <button
        className="cta"
        onClick={check}
        disabled={busy || !items.length || items.length > 30}
      >
        {busy ? "SEARCH IN PROGRESS…" : "SEARCH STORES & PRICES ↗"}
      </button>
      {busy && (
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
        Discovers mapped grocery stores from every retailer in the radius. Each
        is checked for a supported public scraper or connected price source.
        Online catalog listings do not establish branch prices. Complete
        branch-priced baskets include driving; tax and stock remain unverified.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && (
        <div className="search-progress" role="status" aria-live="polite">
          <span className="search-spinner" />
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
          <small>Available prices will appear as each source responds.</small>
        </div>
      )}
      {result && sourcesBusy && (
        <p role="status" aria-live="polite" className="small">
          Nearby stores are ready. Live prices are updating in the background; {visibleCatalogs.length} {visibleCatalogs.length === 1 ? "retailer has" : "retailers have"} a validated online price so far.
        </p>
      )}
      {sourceError && <p role="alert" className="small">{sourceError}</p>}
      {result && (
        <>
          {result.agent && (
            <p className="small">
              {result.agent.mode}
              {result.agent.aiConnected && result.agent.reviewedMatches
                ? ` AI reviewed ${result.agent.reviewedMatches} product matches.`
                : ""}
            </p>
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
          <p>{result.coverage}</p>
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
              {visibleCatalogs.length} retailer catalogs returned validated online prices.
            </strong>{" "}
            Review these separately below.
          </p>
          {result.storeCoverage.length > visibleBranches.length && (
            <p className="small">
              {result.storeCoverage.length - visibleBranches.length} nearby locations had no verified branch price and are hidden from comparison.
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
            {completeTrips
              .sort((a, b) => a.totalCents - b.totalCents)
              .map((trip) => (
                <p key={trip.id}>
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
                </p>
              ))}
          </div>
          {!!(catalogReports.length || result.storeCoverage.length) && (
            <button
              type="button"
              disabled={busy || sourcesBusy}
              onClick={() => void refreshProvider()}
            >
              {sourcesBusy ? "Checking sources…" : "Refresh background prices"}
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
          <div className="live-grid">
            {visibleBranches.map((store) => {
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
                  <strong>
                    {total === null
                      ? "Incomplete basket — missing or unreviewed prices"
                      : `Reviewed groceries: $${(total / 100).toFixed(2)}`}
                  </strong>
                  {total !== null &&
                    totals.length >= 2 &&
                    total === Math.min(...totals) && (
                      <p>
                        Lowest reviewed grocery subtotal among these complete
                        baskets. Compare travel before choosing a trip.
                      </p>
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
