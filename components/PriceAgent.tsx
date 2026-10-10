"use client";
import StoreColumns from "./StoreColumns";
import { useState, useEffect, useRef } from "react";
import type { AgentItem, StoreCheck } from "@/lib/price-agent";
import { reviewedTotal } from "@/lib/price-agent";
import type { SearchOrigin } from "@/lib/locations";
import type { StoreCoverage } from "@/lib/retailer-coverage";
import type { ScrapeReport } from "@/lib/retailer-scraper";
import { mergeCatalogReports } from "@/lib/merge-catalog-reports";
import { centers } from "@/lib/locations";
import type { GasStop } from "@/lib/gas-stop";
import { fuelCostCents } from "@/lib/live-trip";
import { normalizedUnitPrice } from "@/lib/package-match";
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
  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void check();
    }
  }, [autoStart]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
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
      busy ||
      !result?.publicCatalogs.some(
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
  }, [busy, result]);
  useEffect(() => {
    if (!busy) return;
    setPhase(0);
    const timer = setInterval(() => setPhase((p) => Math.min(p + 1, 2)), 4000);
    return () => clearInterval(timer);
  }, [busy]);
  async function check() {
    setBusy(true);
    setError("");
    setResult(null);
    setLiveReports([]);
    setAgentStage("waiting");
    setChoices({});
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
        signal: AbortSignal.timeout(240000),
      });
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
          pending += decoder.decode(chunk.value, { stream: !chunk.done });
          const messages = pending.split("\n");
          pending = messages.pop() ?? "";
          for (const message of messages) {
            if (!message.trim()) continue;
            const event = JSON.parse(message);
            if (event.type === "error") throw new Error(event.error);
            if (event.type === "agent") setAgentStage(event.stage);
            if (event.type === "report")
              setLiveReports((previous) => [
                ...previous.filter((r) => r.retailer !== event.report.retailer),
                event.report,
              ]);
            if (event.type === "complete") setResult(event.result);
          }
          if (chunk.done) break;
        }
      } finally {
        reader.releaseLock();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Price check unavailable.");
    } finally {
      setBusy(false);
    }
  }
  async function refreshProvider() {
    if (!result || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/live/provider-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zip,
          items,
          retailers: [...new Set(result.storeCoverage.map((s) => s.retailer))],
          broaden: true,
        }),
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error("Could not refresh provider prices.");
      const data = await response.json();
      setResult((previous) =>
        previous
          ? {
              ...previous,
              publicCatalogs: previous.publicCatalogs.map((report) => {
                const update = data.reports.find(
                  (candidate: ScrapeReport) =>
                    candidate.retailer === report.retailer,
                );
                return update?.retailer === "The Fresh Market"
                  ? mergeCatalogReports(report, update)
                  : (update ?? report);
              }),
            }
          : previous,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed.");
    } finally {
      setBusy(false);
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
  return (
    <section
      className="live-sources search-workspace"
      aria-label="Basket price agent"
    >
      {!result && liveReports.length > 0 && (
        <StoreColumns reports={liveReports} items={items} />
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
        These results do not include travel, tax, or verified stock.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && (
        <div className="search-progress" role="status" aria-live="polite">
          <span className="search-spinner" />
          {agentStage === "planning"
            ? "Local AI is planning food searches…"
            : agentStage === "ready"
              ? "AI search plan ready. Checking retailer pages…"
              : agentStage === "reviewing"
                ? "Local AI is reviewing product matches…"
                : agentStage === "unavailable"
                  ? "Local AI is unavailable. Checking connected websites…"
                  : [
                      "Finding stores and connected sources…",
                      "Searching products and checking packages…",
                      "Waiting for sources to respond…",
                    ][phase]}
          <small>Live collection can take a few minutes.</small>
        </div>
      )}
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
          <div className="search-filters" aria-label="Filter results">
            {[
              ["all", "All stores"],
              ["retrieved", "Prices found"],
              ["pending", "Collecting"],
              ["unavailable", "Unavailable"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </button>
            ))}
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
                result.storeCoverage.filter((s) => s.status === "checked")
                  .length
              }{" "}
              / {result.foundStores ?? result.storeCoverage.length} locations
              have prices eligible for trip ranking.
            </strong>{" "}
            Unpriced stores cannot be ranked as cheapest.
          </p>
          <p className="small">
            Retailers found:{" "}
            {[...new Set(result.storeCoverage.map((s) => s.retailer))].join(
              " · ",
            ) || "None returned"}
          </p>
          <p>
            <strong>
              {result.publicCatalogs?.filter(
                (report) => report.status === "retrieved",
              ).length ?? 0}{" "}
              retailer catalogs returned live advertised prices.
            </strong>{" "}
            Review these separately below.
          </p>
          <details>
            <summary>All discovered retailers and price coverage</summary>
            <ul className="place-list">
              {result.storeCoverage.map((s) => (
                <li key={s.id}>
                  <a href={s.mapUrl} target="_blank" rel="noreferrer">
                    {s.name} ↗
                  </a>
                  <span>
                    {s.retailer} · {s.miles} mi ·{" "}
                    {s.address || "Address not supplied"}
                  </span>
                  <strong>
                    {s.status === "checked"
                      ? "Price source checked"
                      : s.status === "failed"
                        ? "Price check failed"
                        : "No verified branch price yet"}
                  </strong>
                  <span>{s.detail}</span>
                </li>
              ))}
            </ul>
          </details>
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
          {!!result.publicCatalogs?.length && (
            <button type="button" disabled={busy} onClick={refreshProvider}>
              {busy ? "Checking progress…" : "Refresh background prices"}
            </button>
          )}
          {!!result.publicCatalogs?.length && (
            <StoreColumns
              items={items}
              reports={result.publicCatalogs
                .filter(
                  (report) =>
                    filter === "all" ||
                    (filter === "unavailable"
                      ? !["retrieved", "pending"].includes(report.status)
                      : report.status === filter),
                )
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
          {!!result.publicCatalogs?.some((report) => !report.lines.length) && (
            <details>
              <summary>Scraping availability for other retailers</summary>
              <ul className="place-list">
                {result.publicCatalogs
                  .filter((report) => !report.lines.length)
                  .map((report) => (
                    <li key={report.retailer}>
                      <strong>{report.retailer}</strong>
                      <span>{report.detail}</span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
          {!result.stores.length && (
            <p>
              No branch-verified prices returned for these stores. Public
              catalog prices above are reference prices; local basket ranking
              remains unavailable.
            </p>
          )}
          <div className="live-grid">
            {result.stores.map((store) => {
              const total = reviewedTotal(store, choices[store.id] ?? {});
              return (
                <article className="live-card" key={store.id}>
                  <h3>{store.name}</h3>
                  <p>{store.address}</p>
                  {store.lines.map((line) => (
                    <label
                      key={line.item.id}
                      style={{ display: "block", marginBottom: 16 }}
                    >
                      {line.item.quantity} × {line.item.name} · requested{" "}
                      {line.item.unit}
                      <select
                        aria-label={`${store.name}: ${line.item.name}`}
                        value={choices[store.id]?.[line.item.id] ?? ""}
                        onChange={(e) =>
                          setChoices((c) => ({
                            ...c,
                            [store.id]: {
                              ...c[store.id],
                              [line.item.id]: e.target.value,
                            },
                          }))
                        }
                      >
                        <option value="">Review a matching package</option>
                        {line.candidates.map((p) => (
                          <option
                            key={p.id}
                            value={p.id}
                            disabled={!p.regularCents || p.soldBy !== "UNIT"}
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
                      {line.error && <span>{line.error}</span>}
                      {!line.error && !line.candidates.length && (
                        <span>No matching search results.</span>
                      )}
                    </label>
                  ))}
                  <strong>
                    {total === null
                      ? "Incomplete — review every item"
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
        </>
      )}
    </section>
  );
}
