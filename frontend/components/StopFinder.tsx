"use client";
import { useEffect, useState } from "react";
import OpenMap from "./OpenMap";
import { originQuery, type SearchOrigin } from "@/lib/locations";
import type {
  Area,
  NearbyPlace,
  FuelQuote,
  LocalFuelResult,
} from "@/lib/live-data";
import type { GasStop } from "@/lib/gas-stop";
export default function StopFinder({
  area,
  origin,
  onStation,
  selectedStation,
  autoLoad = false,
  compact = false,
  radius: selectedRadius,
  onRadiusChange,
  onPlaces,
  onPlacesError,
  selectedPlaceId,
}: {
  area: Area;
  origin: SearchOrigin | null;
  onStation: (stop: GasStop | null, quote: FuelQuote | null) => void;
  selectedStation: GasStop | null;
  autoLoad?: boolean;
  compact?: boolean;
  radius?: number;
  onRadiusChange?: (radius: number) => void;
  onPlaces?: (places: NearbyPlace[]) => void;
  onPlacesError?: (error: string) => void;
  selectedPlaceId?: string | null;
}) {
  const selectedStationId = selectedStation?.id ?? null;
  const [localRadius, setLocalRadius] = useState(5);
  const radius = selectedRadius ?? localRadius;
  const [kind, setKind] = useState("all"),
    [places, setPlaces] = useState<NearbyPlace[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [prices, setPrices] = useState<LocalFuelResult | null>(null),
    [priceBusy, setPriceBusy] = useState(false),
    [priceError, setPriceError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!autoLoad && !attempt) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    onPlacesError?.("");
    setLoaded(false);
    setPlaces([]);
    onPlaces?.([]);
    fetch(
      `/api/live/places?area=${area}&radius=${radius}&kind=all${originQuery(origin)}`,
      { signal: controller.signal },
    )
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok)
          throw new Error(
            data.error || "Location search failed. Retry your search.",
          );
        return data;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setPlaces(data.places);
          onPlaces?.(data.places);
          setLoaded(true);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          onPlacesError?.(e.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [area, origin?.lat, origin?.lon, radius, attempt, autoLoad]);
  useEffect(() => {
    if (selectedPlaceId) setKind("all");
  }, [selectedPlaceId]);
  async function checkFuel() {
    setPriceBusy(true);
    setPriceError("");
    try {
      const r = await fetch(
        `/api/live/local-fuel?area=${area}&radius=${radius}&type=REGULAR_UNLEADED${originQuery(origin)}`,
        { signal: AbortSignal.timeout(30000) },
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Pump-price search failed.");
      setPrices(data);
    } catch (e) {
      setPriceError(
        e instanceof Error ? e.message : "Pump-price search failed.",
      );
    } finally {
      setPriceBusy(false);
    }
  }
  const visible = places.filter((p) => kind === "all" || p.kind === kind);
  return (
    <article
      className={"stop-finder" + (compact ? " compact-stop-finder" : "")}
    >
      {!compact && <p className="eyebrow">GROCERIES + GAS · ONE GOOD ROUTE</p>}
      <h2 id="live-title">Nearby stores and gas</h2>
      {!compact && (
        <p>
          See nearby grocery stores and gas stations together. Start with your
          list, then choose the stops that work for your trip.
        </p>
      )}
      {selectedStation && (
        <p className="selected-gas-stop" role="status">
          <strong>Gas stop selected: {selectedStation.name}</strong> · Route and
          fuel total include this station.{" "}
          <button type="button" onClick={() => onStation(null, null)}>
            Remove gas stop
          </button>
        </p>
      )}
      <div className="stop-toolbar">
        <label>
          Search radius
          <select
            value={radius}
            onChange={(e) => {
              const nextRadius = Number(e.target.value);
              if (onRadiusChange) onRadiusChange(nextRadius);
              else setLocalRadius(nextRadius);
              setPrices(null);
              onStation(null, null);
            }}
          >
            {[1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} miles
              </option>
            ))}
          </select>
        </label>
        <div className="search-filters">
          {[
            ["all", "All stops"],
            ["grocery", "Groceries"],
            ["fuel", "Gas stations"],
          ].map(([value, label]) => (
            <button
              type="button"
              key={value}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setAttempt((n) => n + 1)}
        >
          {busy ? "Finding your stops…" : "Refresh stops ↗"}
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="next-stop-map">
        <OpenMap
          area={area}
          origin={origin}
          radius={radius}
          places={visible}
          selectedFuelId={selectedStationId}
          selectedPlaceId={selectedPlaceId}
          onSelectFuel={(place) =>
            onStation(
              {
                id: place.id,
                name: place.name,
                address: place.address,
                lat: place.lat,
                lon: place.lon,
                mapUrl: place.mapUrl,
              },
              null,
            )
          }
        />
      </div>
      <div className="stop-directory">
        <p role="status">
          {busy
            ? "Loading groceries and gas stations…"
            : `${visible.length} mapped stops within ${radius} miles of ${origin?.label || area}.`}
        </p>
        {loaded && !visible.length && (
          <p>No mapped stops matched this filter. Try a wider radius.</p>
        )}
        <ul className="stop-results">
          {visible.map((p) => (
            <li key={p.id}>
              <span
                className={p.kind === "fuel" ? "stop-dot fuel" : "stop-dot"}
              />
              <div>
                <a href={p.mapUrl} target="_blank" rel="noreferrer">
                  {p.name} ↗
                </a>
                <small>
                  {p.kind === "fuel" ? "Gas station" : "Grocery stop"} ·{" "}
                  {p.miles} mi · Address: {p.address || "Not listed in map data"}
                </small>
                {p.kind === "fuel" && (
                  <button
                    type="button"
                    aria-pressed={selectedStationId === p.id}
                    onClick={() =>
                      onStation(
                        {
                          id: p.id,
                          name: p.name,
                          address: p.address,
                          lat: p.lat,
                          lon: p.lon,
                          mapUrl: p.mapUrl,
                        },
                        null,
                      )
                    }
                  >
                    {selectedStationId === p.id
                      ? "Selected gas stop ✓"
                      : "Add gas stop to trip"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <details>
          <summary>Check reported pump prices</summary>
          <p>
            Map locations do not include pump prices. Search the connected price
            provider for reported regular-gas prices.
          </p>
          <button type="button" disabled={priceBusy} onClick={checkFuel}>
            {priceBusy ? "Checking pump reports…" : "Check pump prices"}
          </button>
          {priceError && <p role="alert">{priceError}</p>}
          {prices?.stations.map((s) => (
            <div className="live-card" key={s.id}>
              <strong>{s.name}</strong>
              <p>
                {s.dollarsPerGallon === null
                  ? "No pump report returned"
                  : `$${s.dollarsPerGallon.toFixed(3)} / gallon`}
              </p>
              <button
                type="button"
                aria-pressed={selectedStationId === s.id}
                onClick={() =>
                  onStation(
                    {
                      id: s.id,
                      name: s.name,
                      address: s.address,
                      lat: s.lat,
                      lon: s.lon,
                      mapUrl: s.mapUrl,
                    },
                    !s.stale && s.dollarsPerGallon !== null && s.updatedAt
                      ? {
                          kind: "station",
                          stationName: s.name,
                          dollarsPerGallon: s.dollarsPerGallon,
                          period: s.updatedAt,
                          retrievedAt: prices.retrievedAt,
                          sourceUrl: s.mapUrl,
                          region: s.address,
                        }
                      : null,
                  )
                }
              >
                {selectedStationId === s.id
                  ? "Selected gas stop ✓"
                  : "Add this gas stop to trip"}
              </button>
              {(s.stale || s.dollarsPerGallon === null) && (
                <small>Using your entered gas price for this stop.</small>
              )}
            </div>
          ))}
        </details>
        <p className="small">
          OpenStreetMap locations can be incomplete. Distances are straight-line
          estimates; grocery and pump prices require separate verified sources.
        </p>
      </div>
    </article>
  );
}
