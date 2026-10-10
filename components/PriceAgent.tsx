"use client";
import { useState } from "react";
import type { AgentItem, StoreCheck } from "@/lib/price-agent";
import { reviewedTotal } from "@/lib/price-agent";
import type { SearchOrigin } from "@/lib/locations";
import type { StoreCoverage } from "@/lib/retailer-coverage";
export default function PriceAgent({
  items,
  zip,
  area,
  origin,
}: {
  items: AgentItem[];
  zip: string;
  area: "downtown" | "midtown" | "decatur";
  origin: SearchOrigin | null;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<{
    stores: StoreCheck[];
    coverage: string;
    checkedAt: string;
    storeCoverage: StoreCoverage[];
    warnings: string[];
    foundStores: number;
  } | null>(null);
  const [choices, setChoices] = useState<
    Record<string, Record<string, string>>
  >({});
  const [radius, setRadius] = useState(5);
  async function check() {
    setBusy(true);
    setError("");
    setResult(null);
    setChoices({});
    try {
      const response = await fetch("/api/live/compare", {
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
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Price check unavailable.");
    } finally {
      setBusy(false);
    }
  }
  const totals =
    result?.stores
      .map((s) => reviewedTotal(s, choices[s.id] ?? {}))
      .filter((n): n is number => n !== null) ?? [];
  return (
    <section className="live-sources" aria-label="Basket price agent">
      <p className="eyebrow">ONE LIST. A SECOND LOOK.</p>
      <h2>Check before you checkout.</h2>
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
        {busy ? "CHECKING YOUR LIST…" : "CHECK MY LIST ↗"}
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
        needs a connected price source before its basket can be compared. These
        results do not include travel, tax, or verified stock.
      </p>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
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
              have a price check.
            </strong>{" "}
            Unpriced stores cannot be ranked as cheapest.
          </p>
          <p className="small">
            Retailers found:{" "}
            {[...new Set(result.storeCoverage.map((s) => s.retailer))].join(
              " · ",
            ) || "None returned"}
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
                        : "Prices unavailable"}
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
          {!result.stores.length && (
            <p>
              No connected source returned prices for these stores. Store
              discovery succeeded; live basket comparison is not available yet.
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
