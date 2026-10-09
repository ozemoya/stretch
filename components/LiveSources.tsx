"use client";
import { useEffect, useRef, useState } from "react";
import { areaFromIp } from "@/lib/ip-area";
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
  const r = await fetch(url, { signal: AbortSignal.timeout(25000) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error ?? "Live data is unavailable.");
  return data;
}
export default function LiveSources({
  area,
  onFuel,
  onArea,
}: {
  area: Area;
  onFuel: (quote: FuelQuote) => void;
  onArea: (area: Area) => void;
}) {
  const areaCallback = useRef(onArea);
  areaCallback.current = onArea;
  const manualArea = useRef(false);
  const [locationNote, setLocationNote] = useState(
    "Finding your approximate area from your IP…",
  );
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    fetch("https://ipapi.co/json/", {
      signal: controller.signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Location unavailable");
        const data = await response.json();
        if (!active || controller.signal.aborted || manualArea.current) return;
        const detected =
          !data.error && areaFromIp(data.latitude, data.longitude);
        if (detected) {
          areaCallback.current(detected);
          setPlaces(null);
          setLocationNote(
            `Approximate IP location: ${typeof data.city === "string" ? data.city : "Atlanta area"}. Showing the nearest supported demo area: ${detected}. You can change it below.`,
          );
        } else
          setLocationNote(
            "Your IP location is outside our supported Atlanta demo areas. Choose an area below.",
          );
      })
      .catch(() => {
        if (active && !manualArea.current)
          setLocationNote("IP location is unavailable. Choose an area below.");
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  const [places, setPlaces] = useState<{
      places: NearbyPlace[];
      updatedAt: string;
      area: Area;
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
        await request<{ places: NearbyPlace[]; updatedAt: string; area: Area }>(
          `/api/live/places?area=${area}`,
        ),
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
          value={area}
          onChange={(e) => {
            manualArea.current = true;
            setLocationNote(
              "Using your selected area. IP detection will not override it.",
            );
            onArea(e.target.value as Area);
            setPlaces(null);
            setPlaceError("");
          }}
        >
          <option value="downtown">Downtown Atlanta</option>
          <option value="midtown">Midtown Atlanta</option>
          <option value="decatur">Decatur</option>
        </select>
      </label>
      <p className="small" role="status">
        {locationNote}
      </p>
      <p className="small">
        Approximate location provided by ipapi.co using your public IP. VPNs and
        mobile networks can change the result; your IP is not saved by Stretch.
      </p>
      <div className="live-grid">
        <LocalFuel key={area} area={area} onFuel={onFuel} />
        <article className="live-card">
          <span className="live-badge">REAL STORE LOCATIONS</span>
          <h3>Good stops nearby.</h3>
          <p>
            Shows up to 60 nearby places within five miles of your selected area
            center. Map coverage can be incomplete; locations do not include
            grocery or pump prices.
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
                Results for {places.area}. Straight-line distance, not driving
                distance.
              </p>
              <OpenMap area={places.area} radius={5} places={places.places} />
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
