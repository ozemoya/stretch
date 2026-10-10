"use client";
import { useEffect, useRef, useState } from "react";
import { detectLocation } from "@/lib/detect-location";
import { originQuery, type SearchOrigin } from "@/lib/locations";
import type { Area, FuelQuote, NearbyPlace } from "@/lib/live-data";
import LocalFuel from "./LocalFuel";
import OpenMap from "./OpenMap";

type Price = {
  id: string;
  name: string;
  brand: string;
  size: string;
  soldBy: string;
  upc: string;
  regularCents: number | null;
  promoCents: number | null;
  retrievedAt: string;
};
const usd = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
async function request<T>(url: string): Promise<T> {
  const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Live data is unavailable.");
  return data;
}
export default function LiveSources({
  area,
  onFuel,
  onArea,
  origin,
  onOrigin,
}: {
  area: Area;
  onFuel: (quote: FuelQuote) => void;
  onArea: (area: Area) => void;
  origin: SearchOrigin | null;
  onOrigin: (origin: SearchOrigin | null) => void;
}) {
  const originCallback = useRef(onOrigin);
  originCallback.current = onOrigin;
  const manualArea = useRef(false);
  const [locationNote, setLocationNote] = useState(
    "Finding your approximate area from your IP…",
  );
  const [detecting, setDetecting] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setDetecting(true);
    setLocationNote("Finding your approximate area from your IP…");
    detectLocation(controller.signal)
      .then((detected) => {
        if (!active || controller.signal.aborted || manualArea.current) return;
        originCallback.current(detected);
        setPlaces(null);
        setLocationNote(
          `Approximate IP location: ${detected.label}. Nearby searches use these coordinates. You can change the area below.`,
        );
      })
      .catch(() => {
        if (active && !manualArea.current)
          setLocationNote("IP location is unavailable. Choose an area below.");
      })
      .finally(() => {
        if (active) setDetecting(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt]);
  const [places, setPlaces] = useState<{
      places: NearbyPlace[];
      updatedAt: string;
      area: Area;
      origin: SearchOrigin;
    } | null>(null),
    [placeError, setPlaceError] = useState(""),
    [placeLoading, setPlaceLoading] = useState(false);
  const [kind, setKind] = useState<"grocery" | "fuel">("grocery");
  const [status, setStatus] = useState<{
    kroger: boolean;
    instacart: boolean;
  } | null>(null);
  const [zip, setZip] = useState("30303"),
    [stores, setStores] = useState<
      { id: string; name: string; address: string }[]
    >([]),
    [location, setLocation] = useState("");
  const [term, setTerm] = useState("milk"),
    [products, setProducts] = useState<Price[]>([]),
    [groceryError, setGroceryError] = useState(""),
    [busy, setBusy] = useState(false);
  const [retailers, setRetailers] = useState<
      { retailer_key: string; name: string }[]
    >([]),
    [retailerError, setRetailerError] = useState(""),
    [retailerBusy, setRetailerBusy] = useState(false);
  useEffect(() => {
    let active = true;
    request<{ kroger: boolean; instacart: boolean }>("/api/live/status")
      .then((s) => {
        if (active) setStatus(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  async function getPlaces() {
    setPlaceLoading(true);
    setPlaceError("");
    setPlaces(null);
    try {
      setPlaces(
        await request<{
          places: NearbyPlace[];
          updatedAt: string;
          area: Area;
          origin: SearchOrigin;
        }>(`/api/live/places?area=${area}${originQuery(origin)}`),
      );
    } catch (e) {
      setPlaceError((e as Error).message);
    } finally {
      setPlaceLoading(false);
    }
  }
  async function getStores() {
    setBusy(true);
    setGroceryError("");
    setStores([]);
    setProducts([]);
    setLocation("");
    try {
      const r = await request<{ stores: typeof stores }>(
        `/api/live/kroger?zip=${encodeURIComponent(zip)}`,
      );
      setStores(r.stores);
      setLocation(r.stores[0]?.id ?? "");
      if (!r.stores.length)
        setGroceryError("No Kroger locations returned near this ZIP.");
    } catch (e) {
      setGroceryError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function getProducts() {
    setBusy(true);
    setGroceryError("");
    setProducts([]);
    try {
      const r = await request<{ products: Price[] }>(
        `/api/live/kroger?locationId=${encodeURIComponent(location)}&term=${encodeURIComponent(term)}`,
      );
      setProducts(r.products);
      if (!r.products.length)
        setGroceryError("No matching products returned at this store.");
    } catch (e) {
      setGroceryError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="live-sources" aria-labelledby="live-title">
      <p className="eyebrow">A LITTLE CLOSER TO REAL LIFE</p>
      <h2 id="live-title">Meet your neighborhood.</h2>
      <p>
        Find real places and check local pump prices. The basket above still
        uses labeled sample groceries and illustrative routes.
      </p>
      <label className="live-area">
        Explore an area
        <select
          value={origin ? "ip" : area}
          onChange={(e) => {
            manualArea.current = true;
            onOrigin(null);
            setLocationNote(
              "Using your selected area. IP detection will not override it.",
            );
            onArea(e.target.value as Area);
            setPlaces(null);
            setPlaceError("");
          }}
        >
          {origin && (
            <option value="ip">Current IP area: {origin.label}</option>
          )}
          <option value="downtown">Downtown Atlanta</option>
          <option value="midtown">Midtown Atlanta</option>
          <option value="decatur">Decatur</option>
        </select>
      </label>
      <button
        className="text-button"
        disabled={detecting}
        onClick={() => {
          manualArea.current = false;
          setAttempt((a) => a + 1);
        }}
      >
        {" "}
        {detecting ? "DETECTING LOCATION…" : "DETECT MY AREA ↗"}
      </button>
      <p className="small" role="status">
        {locationNote}
      </p>
      {origin && (
        <p className="small">
          Your detected coordinates are used for nearby stores and gas stations.
          The sample trip cards still use illustrative {area} routes.
        </p>
      )}
      {origin && (
        <details>
          <summary>Approximate location details</summary>
          <p>
            Search center: {origin.lat}, {origin.lon}. IP locations can cover a
            broad area; this is not GPS.
          </p>
        </details>
      )}
      <p className="small">
        Approximate location provided by IPwhois; ipify is used if needed. VPNs
        and mobile networks can change the result; your IP is not saved by
        Stretch.
      </p>
      <div className="live-grid">
        <LocalFuel
          key={JSON.stringify([area, origin])}
          area={area}
          origin={origin}
          onFuel={onFuel}
        />
        <article className="live-card">
          <span className="live-badge">REAL STORE LOCATIONS</span>
          <h3>Good stops nearby.</h3>
          <p>
            Finds mapped supermarkets, grocery shops and convenience stores from
            every retailer within five miles of your selected area center. Map
            coverage can be incomplete; locations do not include grocery or pump
            prices.
          </p>
          <button
            className="button"
            onClick={getPlaces}
            disabled={placeLoading}
          >
            {placeLoading ? "Finding places…" : "FIND NEARBY STOPS ↗"}
          </button>
          {placeError && <p role="alert">{placeError}</p>}
          {places && (
            <>
              <p>
                Results for {places.origin.label}. Straight-line distance, not
                driving distance.
              </p>
              <OpenMap
                area={places.area}
                origin={places.origin}
                radius={5}
                places={places.places}
              />
              <div className="live-tabs">
                <button
                  className="text-button"
                  aria-pressed={kind === "grocery"}
                  onClick={() => setKind("grocery")}
                >
                  Groceries
                </button>
                <button
                  className="text-button"
                  aria-pressed={kind === "fuel"}
                  onClick={() => setKind("fuel")}
                >
                  Gas stations
                </button>
              </div>
              <ul className="place-list">
                {places.places
                  .filter((p) => p.kind === kind)
                  .map((p) => (
                    <li key={p.id}>
                      <a href={p.mapUrl} target="_blank" rel="noreferrer">
                        {p.name} ↗
                      </a>
                      <span>
                        {p.miles} mi · {p.address || "Address not supplied"}
                      </span>
                    </li>
                  ))}
              </ul>
              {!places.places.some((p) => p.kind === kind) && (
                <p>No mapped matches returned.</p>
              )}
              <p className="small">
                ©{" "}
                <a
                  href="https://www.openstreetmap.org/copyright"
                  target="_blank"
                  rel="noreferrer"
                >
                  OpenStreetMap contributors
                </a>{" "}
                · Map data {places.updatedAt}
              </p>
            </>
          )}
        </article>
      </div>
      <article className="live-card grocery-connection">
        <span className="live-badge">
          {status?.kroger
            ? "CREDENTIALS CONFIGURED · CHECK PRICES"
            : "DEVELOPER ACCESS NEEDED"}
        </span>
        <h3>Real groceries. Exact packages.</h3>
        <p>
          Kroger product search returns store-specific API prices after its
          developer credentials are configured. Select a location and check the
          brand, package size, and selling unit. Prices are kept separate from
          the sample basket.
        </p>
        {!status?.kroger && (
          <p>
            <a
              href="https://developer.kroger.com/"
              target="_blank"
              rel="noreferrer"
            >
              Set up Kroger developer access ↗
            </a>
          </p>
        )}
        <div className="settings">
          <label>
            ZIP code
            <input
              inputMode="numeric"
              maxLength={5}
              value={zip}
              onChange={(e) => {
                setZip(e.target.value);
                setStores([]);
                setLocation("");
                setProducts([]);
              }}
            />
          </label>
          <button
            className="button"
            disabled={!status?.kroger || busy || !/^\d{5}$/.test(zip)}
            onClick={getStores}
          >
            {busy ? "Checking…" : "FIND KROGER STORES ↗"}
          </button>
        </div>
        {stores.length > 0 && (
          <div className="settings">
            <label>
              Kroger location
              <select
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setProducts([]);
                }}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.address}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Product search
              <input
                value={term}
                maxLength={60}
                onChange={(e) => {
                  setTerm(e.target.value);
                  setProducts([]);
                }}
              />
            </label>
            <button
              className="button"
              disabled={busy || term.trim().length < 2}
              onClick={getProducts}
            >
              CHECK STORE PRICES ↗
            </button>
          </div>
        )}
        {groceryError && <p role="alert">{groceryError}</p>}
        {!!products.length && (
          <>
            <p>
              Regular prices are displayed; promotions may require eligibility.
              A missing price means unknown, never free. Availability and
              dietary labels must be confirmed with the retailer.
            </p>
            <ul className="live-products">
              {products.map((p) => (
                <li key={p.id}>
                  <strong>{p.name}</strong>
                  <p>
                    {p.brand} · {p.size} · Sold by: {p.soldBy} · UPC{" "}
                    {p.upc || "not supplied"}
                  </p>
                  <b>
                    {p.regularCents === null
                      ? "Price unavailable"
                      : usd(p.regularCents)}
                  </b>
                  {p.promoCents !== null && (
                    <span>
                      {" "}
                      · Promotion {usd(p.promoCents)} (conditions may apply)
                    </span>
                  )}
                  <p className="small">
                    Fetched {new Date(p.retrievedAt).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
        <details>
          <summary>More retailers through Instacart</summary>
          <p>
            Instacart can list participating retailer brands near a ZIP. This
            endpoint does not supply individual store addresses or basket
            prices.
          </p>
          <p>
            <a
              href="https://docs.instacart.com/developer_platform_api/"
              target="_blank"
              rel="noreferrer"
            >
              Instacart developer access ↗
            </a>
          </p>
          <button
            className="text-button"
            disabled={
              !status?.instacart || retailerBusy || !/^\d{5}$/.test(zip)
            }
            onClick={async () => {
              setRetailerBusy(true);
              setRetailerError("");
              setRetailers([]);
              try {
                setRetailers(
                  (
                    await request<{ retailers: typeof retailers }>(
                      `/api/live/instacart?zip=${zip}`,
                    )
                  ).retailers,
                );
              } catch (e) {
                setRetailerError((e as Error).message);
              } finally {
                setRetailerBusy(false);
              }
            }}
          >
            {!status?.instacart
              ? "Developer key needed"
              : retailerBusy
                ? "Checking…"
                : "Find participating retailers ↗"}
          </button>
          {retailerError && <p role="alert">{retailerError}</p>}
          <ul>
            {retailers.map((r) => (
              <li key={r.retailer_key}>{r.name}</li>
            ))}
          </ul>
        </details>
      </article>
    </section>
  );
}
