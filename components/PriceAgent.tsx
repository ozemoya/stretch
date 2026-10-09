"use client";
import { useState } from "react";
import type { AgentItem, StoreCheck } from "@/lib/price-agent";
import { reviewedTotal } from "@/lib/price-agent";
export default function PriceAgent({
  items,
  zip,
}: {
  items: AgentItem[];
  zip: string;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [result, setResult] = useState<{
    stores: StoreCheck[];
    coverage: string;
    checkedAt: string;
  } | null>(null);
  const [choices, setChoices] = useState<
    Record<string, Record<string, string>>
  >({});
  async function check() {
    setBusy(true);
    setError("");
    setResult(null);
    setChoices({});
    try {
      const response = await fetch("/api/live/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ zip, items }),
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
        disabled={busy || !items.length || items.length > 10}
      >
        {busy ? "CHECKING YOUR LIST…" : "CHECK MY LIST ↗"}
      </button>
      <p className="small">
        Up to 10 items and two Kroger locations per check. Other stores need a
        connected price source. These results do not include travel, tax, or
        verified stock.
      </p>
      {error && <p role="alert">{error}</p>}
      {result && (
        <>
          <p>{result.coverage}</p>
          <p className="small">
            Checked {new Date(result.checkedAt).toLocaleString()}. Prices can
            change at checkout.
          </p>
          {!result.stores.length && <p>No supported locations returned.</p>}
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
