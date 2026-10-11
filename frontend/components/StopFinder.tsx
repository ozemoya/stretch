"use client";
import Link from "next/link";
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
import { stationPriceForPlace } from "@/lib/fuel-price-provider";
export default function StopFinder({
  area,
  origin,
  onStation,
  selectedStation,
  selectedQuote,
  autoLoad = false,
  compact = false,
  radius: selectedRadius,
  onRadiusChange,
  onPlaces,
  onPlacesError,
  selectedPlaceIds,
  onSelectPlace,
}: {
  area: Area;
  origin: SearchOrigin | null;
  onStation: (stop: GasStop | null, quote: FuelQuote | null) => void;
  selectedStation: GasStop | null;
  selectedQuote?: FuelQuote | null;
  autoLoad?: boolean;
  compact?: boolean;
  radius?: number;
  onRadiusChange?: (radius: number) => void;
  onPlaces?: (places: NearbyPlace[]) => void;
  onPlacesError?: (error: string) => void;
  selectedPlaceIds?: string[];
  onSelectPlace?: (place: NearbyPlace) => void;
}) {
  const selectedStationId = selectedStation?.id ?? null;
  const [localRadius, setLocalRadius] = useState(5);
  const radius = selectedRadius ?? localRadius;
  const [kind, setKind] = useState("all"),
    [places, setPlaces] = useState<NearbyPlace[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [gasQuery, setGasQuery] = useState("");
  const [gasLimit, setGasLimit] = useState(20);
  const [fuelReport, setFuelReport] = useState<LocalFuelResult | null>(null);
  const [fuelBusy, setFuelBusy] = useState(false);
  const [fuelError, setFuelError] = useState("");
  useEffect(() => {
    if (!autoLoad && !attempt) return;
    const controller = new AbortController();
    setBusy(true);
    setError("");
    onPlacesError?.("");
    setLoaded(false);
    if (!expanded) setPlaces([]);
    setFuelReport(null);
    setFuelBusy(true);
    setFuelError("");
    if (!expanded) onPlaces?.([]);
    fetch(
      `/api/live/places?area=${area}&radius=${radius}&kind=all${expanded ? "&coverage=expanded" : ""}${originQuery(origin)}`,
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
    fetch(`/api/live/local-fuel?area=${area}&radius=${radius}&type=REGULAR_UNLEADED${originQuery(origin)}`,
      { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Gas prices could not load.");
        return data as LocalFuelResult;
      })
      .then((data) => { if (!controller.signal.aborted) setFuelReport(data); })
      .catch((cause) => {
        if (!controller.signal.aborted) setFuelError(cause instanceof Error ? cause.message : "Gas prices could not load.");
      })
      .finally(() => { if (!controller.signal.aborted) setFuelBusy(false); });
    return () => controller.abort();
  }, [area, origin?.lat, origin?.lon, radius, attempt, autoLoad, expanded]);
  useEffect(() => {
    if (selectedPlaceIds?.length) setKind("all");
  }, [selectedPlaceIds?.join("|")]);
  const visible = places.filter((p) => kind === "all" || p.kind === kind);
  const gasPlaces = places.filter((place) => place.kind === "fuel");
  const matchingGasPlaces = gasPlaces.filter((place) => `${place.name} ${place.address}`.toLowerCase().includes(gasQuery.toLowerCase()));
  const directoryPlaces = compact ? matchingGasPlaces.slice(0, gasLimit) : visible;
  const quoteFor = (place: NearbyPlace): FuelQuote | null => {
    if (!fuelReport) return null;
    const price = stationPriceForPlace(fuelReport, place.id, place.lat, place.lon);
    if (price?.dollarsPerGallon == null || !price.updatedAt) return null;
    return { kind: "station", stationName: place.name, fuelType: "REGULAR_UNLEADED",
      dollarsPerGallon: price.dollarsPerGallon, period: price.updatedAt,
      retrievedAt: fuelReport.retrievedAt, sourceUrl: place.mapUrl, region: place.address };
  };
  useEffect(() => {
    if (!selectedStation || !fuelReport) return;
    const place = gasPlaces.find((candidate) => candidate.id === selectedStation.id);
    if (!place) return;
    const quote = quoteFor(place);
    if (quote && (!selectedQuote || selectedQuote.fuelType === "REGULAR_UNLEADED") &&
        (selectedQuote?.period !== quote.period || selectedQuote?.dollarsPerGallon !== quote.dollarsPerGallon))
      onStation(selectedStation, quote);
  }, [fuelReport, selectedStation?.id, selectedQuote?.period, selectedQuote?.dollarsPerGallon, selectedQuote?.fuelType]);
  const stopList = <ul className="stop-results">
    {directoryPlaces.map((p) => (
      <li key={p.id}>
        <span className={p.kind === "fuel" ? "stop-dot fuel" : "stop-dot"} />
        <div>
          <a href={p.mapUrl} target="_blank" rel="noreferrer">{p.name} ↗</a>
          <small>{p.kind === "fuel" ? "Gas station" : "Grocery stop"} · {p.miles} mi · {p.address || "Address not listed"}</small>
          {p.kind === "fuel" && <small>{quoteFor(p)
            ? `Regular gas: $${quoteFor(p)!.dollarsPerGallon.toFixed(3)}/gal · Google reported ${new Date(quoteFor(p)!.period).toLocaleString()}`
            : fuelBusy ? "Checking reported gas price…" : "Gas price unavailable"}</small>}
          {p.kind === "fuel" && <button type="button" aria-pressed={selectedStationId === p.id}
            onClick={() => onStation({ id: p.id, name: p.name, address: p.address, lat: p.lat, lon: p.lon, mapUrl: p.mapUrl }, quoteFor(p))}>
            {selectedStationId === p.id ? "Selected gas stop ✓" : "Choose this gas stop"}
          </button>}
        </div>
      </li>
    ))}
  </ul>;
  return (
    <article
      className={"stop-finder" + (compact ? " compact-stop-finder" : "") + (selectedStationId || selectedPlaceIds?.length ? " route-selected" : "")}
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
          <strong>Gas stop: {selectedStation.name}</strong>{" "}
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
              setExpanded(false);
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
        {(!compact || error) && <button
          type="button"
          disabled={busy}
          onClick={() => setAttempt((n) => n + 1)}
        >
          {busy ? "Finding your stops…" : "Refresh stops ↗"}
        </button>}
        {compact && !expanded && <button type="button" disabled={busy} onClick={() => setExpanded(true)}>
          Find more grocery stores ↗
        </button>}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="next-stop-map">
        <OpenMap
          area={area}
          origin={origin}
          radius={radius}
          places={visible}
          routePlaces={places}
          selectedFuelId={selectedStationId}
          selectedPlaceIds={selectedPlaceIds}
          onSelectPlace={onSelectPlace}
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
              quoteFor(place),
            )
          }
        />
      </div>
      <div className="stop-directory">
        <p role="status">
          {error
            ? "Nearby stops could not load. Try Refresh stops shortly."
            : busy
            ? "Loading groceries and gas stations…"
            : `${visible.length} mapped stops within ${radius} miles of ${origin?.label || area}${expanded ? " · expanded search" : ""}.`}
        </p>
        {loaded && !places.length && (
          <p>No mapped stops matched this filter. Try a wider radius.</p>
        )}
        {compact ? <details className="gas-station-list" open>
          <summary>Choose a gas station from the list · {gasPlaces.length}</summary>
          {fuelError && <p className="small" role="status">Reported pump prices could not load. You can still choose a station; checkout will label the driving fuel estimate.</p>}
          <label>Find a station
            <input type="search" value={gasQuery} onChange={(event) => { setGasQuery(event.target.value); setGasLimit(20); }} placeholder="Name or address" />
          </label>
          {stopList}
          {!matchingGasPlaces.length && !!gasPlaces.length && <p>No gas stations match that search.</p>}
          {matchingGasPlaces.length > gasLimit && <button type="button" onClick={() => setGasLimit((count) => count + 20)}>Show 20 more stations</button>}
        </details> : stopList}
        <p><Link href="/gas">Compare reported pump prices and choose a gas stop →</Link></p>
        {!compact && <p className="small">
          Google Maps returns a limited set of nearby stops for each search.
          Distances are straight-line estimates; grocery and pump prices require
          separate verified sources.
        </p>}
      </div>
    </article>
  );
}
