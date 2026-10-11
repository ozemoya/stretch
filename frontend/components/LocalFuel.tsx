"use client";
import { useEffect, useRef, useState } from "react";
import type {
  Area,
  FuelQuote,
  FuelType,
  LocalFuelResult,
  NearbyPlace,
} from "@/lib/live-data";
import OpenMap from "./OpenMap";
import { originQuery, type SearchOrigin } from "@/lib/locations";
export default function LocalFuel({
  area,
  onFuel,
  origin,
  autoLoad = false,
}: {
  area: Area;
  onFuel: (quote: FuelQuote) => void;
  origin?: SearchOrigin | null;
  autoLoad?: boolean;
}) {
  const [radius, setRadius] = useState(3),
    [type, setType] = useState<FuelType>("REGULAR_UNLEADED"),
    [result, setResult] = useState<LocalFuelResult | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [mapped, setMapped] = useState<{
    places: NearbyPlace[];
    updatedAt: string;
    radiusMiles: number;
    area: Area;
    origin: SearchOrigin;
  } | null>(null);
  const run = useRef(0);
  const started = useRef(false);
  useEffect(()=>{if(autoLoad && !started.current){started.current=true;void search();}},[autoLoad]);
  async function search() {
    const id = ++run.current;
    setBusy(true);
    setError("");
    setMapped(null);
    setResult(null);
    try {
      const r = await fetch(
        `/api/live/places?area=${area}&radius=${radius}&kind=fuel${originQuery(origin)}`,
        { signal: AbortSignal.timeout(45000) },
      );
      const data = await r.json();
      if (!r.ok)
        throw new Error(data.error ?? "Station locations unavailable.");
      if (id === run.current) setMapped(data);
    } catch (e) {
      if (id === run.current) setError((e as Error).message);
    } finally {
      if (id === run.current) setBusy(false);
    }
  }
  async function searchPrices() {
    const id = ++run.current;
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await fetch(
        `/api/live/local-fuel?area=${area}&radius=${radius}&type=${type}${originQuery(origin)}`,
        { cache: "no-store", signal: AbortSignal.timeout(25000) },
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Local prices unavailable.");
      if (id === run.current) setResult(d);
    } catch (e) {
      if (id === run.current) setError((e as Error).message);
    } finally {
      if (id === run.current) setBusy(false);
    }
  }
  return (
    <article className="live-card">
      <span className="live-badge">GOOGLE MAPS · LOCAL GAS STATIONS</span>
      <h3>Fill up around you.</h3>
      <p>
        Find mapped gas stations within your radius of the selected area center.
        Google Maps provides nearby locations. Reported pump prices are shown
        separately when available.
      </p>
      <div className="settings">
        <label>
          Gas search radius
          <select
            value={radius}
            disabled={busy}
            onChange={(e) => {
              setRadius(Number(e.target.value));
              setResult(null);
              setMapped(null);
            }}
          >
            {[1, 2, 3, 5, 10].map((r) => (
              <option value={r} key={r}>
                {r} mile{r === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <button className="button" onClick={search} disabled={busy}>
        {busy ? "Checking nearby stations…" : "FIND GAS STATIONS ↗"}
      </button>
      {error && <p role="alert">{error}</p>}
      {mapped && (
        <>
          <OpenMap
            area={mapped.area}
            radius={mapped.radiusMiles}
            places={mapped.places}
            origin={mapped.origin}
          />
          <p>
            {mapped.places.length} mapped stations returned within{" "}
            {mapped.radiusMiles} {mapped.radiusMiles === 1 ? "mile" : "miles"}.
            Straight-line distance from {mapped.origin.label}, not driving
            distance.
          </p>
          <p className="small">
            Locations fetched {new Date(mapped.updatedAt).toLocaleString()} · Google Maps
          </p>
          <ul className="place-list">
            {mapped.places.map((p) => (
              <li key={p.id}>
                <a href={p.mapUrl} target="_blank" rel="noreferrer">
                  {p.name} ↗
                </a>
                <span>
                  {p.address || "Address not supplied"} · {p.miles} mi
                </span>
                <span>Check reported prices below</span>
              </li>
            ))}
          </ul>
          {!mapped.places.length && (
            <p>No mapped stations returned. Try a larger radius.</p>
          )}
        </>
      )}
      <details>
        <summary>Check reported pump prices with a separate provider</summary>
        <p>
          Google Places may provide reported pump prices for some stations.
          Stations with missing prices remain unknown.
        </p>
        <label className="fuel-grade">
          Fuel type
          <select
            value={type}
            disabled={busy}
            onChange={(e) => {
              setType(e.target.value as FuelType);
              setResult(null);
            }}
          >
            <option value="REGULAR_UNLEADED">Regular unleaded</option>
            <option value="MIDGRADE">Midgrade</option>
            <option value="PREMIUM">Premium</option>
            <option value="DIESEL">Diesel</option>
          </select>
        </label>
        <button className="button" onClick={searchPrices} disabled={busy}>
          CHECK REPORTED PRICES ↗
        </button>
        <p className="small">
          <a
            href="https://developers.google.com/maps/documentation/places/web-service/get-api-key"
            target="_blank"
            rel="noreferrer"
          >
            Connect Google Places ↗
          </a>{" "}
          · Developer access is needed for pump prices. Regional averages are not
          used in this search. The selected fuel grade applies to the price lookup.
        </p>
        {result && (
          <div className="local-fuel-results">
            <p className="google-attribution" translate="no">
              Google Maps
            </p>
            <p>
              Up to 20 returned stations within {result.radiusMiles} miles of{" "}
              {result.area}. Straight-line radius, not driving distance. US
              prices shown per gallon. Tax/payment and membership conditions
              should be confirmed at the pump.
            </p>
            <p>
              Fetched {new Date(result.retrievedAt).toLocaleString()}. Prices
              over 48 hours old or without a timestamp cannot be applied.
            </p>
            {!result.stations.length && (
              <p>
                No station results returned for this radius. Try a larger
                radius.
              </p>
            )}
            <ul className="place-list">
              {result.stations.map((s) => (
                <li key={s.id}>
                  <a href={s.mapUrl} target="_blank" rel="noreferrer">
                    {s.name} ↗
                  </a>
                  <span>
                    {s.address} · {s.miles} mi
                  </span>
                  <strong>
                    {s.dollarsPerGallon === null
                      ? "Price not reported"
                      : `$${s.dollarsPerGallon.toFixed(3)} / gallon`}
                  </strong>
                  <span>
                    {s.updatedAt
                      ? `Reported ${new Date(s.updatedAt).toLocaleString()}`
                      : "Report time unknown"}
                    {s.stale ? " · Outdated or unverified" : ""}
                  </span>
                  {s.attributions.map((a) => (
                    <a
                      href={a.url}
                      key={a.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.name}
                    </a>
                  ))}
                  <button
                    className="text-button"
                    disabled={s.stale || s.dollarsPerGallon === null}
                    onClick={() =>
                      onFuel({
                        kind: "station",
                        stationName: s.name,
                        dollarsPerGallon: s.dollarsPerGallon!,
                        period: s.updatedAt!,
                        retrievedAt: result.retrievedAt,
                        sourceUrl: s.mapUrl,
                        region: s.address,
                      })
                    }
                  >
                    Use this station price ↗
                  </button>
                </li>
              ))}
            </ul>
            <p className="small">
              Selecting a price estimates fuel consumed; it does not add the gas
              station as a route stop or include its detour.
            </p>
          </div>
        )}
      </details>
    </article>
  );
}
