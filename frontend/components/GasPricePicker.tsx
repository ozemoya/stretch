"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import OpenMap from "./OpenMap";
import { readCheckoutDraft, writeCheckoutDraft, type CheckoutDraft } from "@/lib/checkout-draft";
import { cartGroups, readCart } from "@/lib/smart-cart";
import { calculateGasSavings, milesFromRoadMatrix } from "@/lib/gas-savings";
import { stationPriceForPlace } from "@/lib/fuel-price-provider";
import { deduplicatePhysicalStations } from "@/lib/gas-stations";
import { centers, originQuery, type SearchOrigin } from "@/lib/locations";
import { detectDeviceLocation } from "@/lib/detect-location";
import type { Area, FuelType, LocalFuelResult, NearbyPlace } from "@/lib/live-data";

const grades: { value: FuelType; label: string }[] = [
  { value: "REGULAR_UNLEADED", label: "Regular" }, { value: "MIDGRADE", label: "Midgrade" },
  { value: "PREMIUM", label: "Premium" }, { value: "DIESEL", label: "Diesel" },
];
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
type Details = { id: string; businessStatus?: string; rating?: number; currentOpeningHours?: { openNow?: boolean };
  websiteUri?: string; nationalPhoneNumber?: string; attributions?: { provider: string; providerUri?: string }[] };
type CartLocation = { id: string; lat: number; lon: number };

export default function GasPricePicker() {
  const params = useSearchParams();
  const back = params.get("return") === "cart" ? "/cart" : "/plan/results";
  const [draft, setDraft] = useState<CheckoutDraft | null>(null);
  const [origin, setOrigin] = useState<SearchOrigin | null>(null);
  const [area, setArea] = useState<Area>("downtown");
  const [locationInput, setLocationInput] = useState("");
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationError, setLocationError] = useState("");
  const locationSequence = useRef(0);
  const locationRequest = useRef<AbortController | null>(null);
  const [radius, setRadius] = useState(5);
  const [grade, setGrade] = useState<FuelType>("REGULAR_UNLEADED");
  const [sort, setSort] = useState<"distance" | "price">("distance");
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [places, setPlaces] = useState<NearbyPlace[]>([]);
  const [report, setReport] = useState<LocalFuelResult | null>(null);
  const [placesBusy, setPlacesBusy] = useState(false);
  const [pricesBusy, setPricesBusy] = useState(false);
  const [placesError, setPlacesError] = useState("");
  const [pricesError, setPricesError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [baselineId, setBaselineId] = useState("");
  const [details, setDetails] = useState<Details | null>(null);
  const [detailsError, setDetailsError] = useState("");
  const [gallons, setGallons] = useState(10);
  const [mpg, setMpg] = useState(25);
  const [maxDetour, setMaxDetour] = useState(10);
  const [cartStores, setCartStores] = useState<CartLocation[]>([]);
  const [cartStoreCount, setCartStoreCount] = useState(0);
  const [road, setRoad] = useState<{ base: number; baseline: number; selected: number } | null>(null);
  const [roadError, setRoadError] = useState("");
  const [roadBusy, setRoadBusy] = useState(false);

  useEffect(() => {
    const saved = readCheckoutDraft(sessionStorage);
    setDraft(saved); setArea(saved?.prefs.area ?? "downtown");
    if (saved && !saved.ipArea) {
      setOrigin(saved.origin ?? { ...centers[saved.prefs.area], label: saved.prefs.area, source: "manual" });
    } else {
      void useMyLocation();
    }
    setMpg(saved?.prefs.mpg ?? 25);
    setGallons(saved?.gasGallonsNeeded ?? 10);
    const stores = cartGroups(readCart(localStorage)).map(({ store }) => ({ id: store.id, lat: store.lat, lon: store.lon }));
    setCartStores(stores.slice(0, 3)); setCartStoreCount(stores.length);
    try { const ids = JSON.parse(localStorage.getItem("stretch.preferred-gas-stations") || "[]");
      if (Array.isArray(ids)) setFavorites(ids.filter((id): id is string => typeof id === "string")); } catch { /* Keep empty. */ }
  }, []);

  useEffect(() => () => { locationSequence.current++; locationRequest.current?.abort(); }, []);

  useEffect(() => {
    if (!origin) return;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]);
    setPlacesBusy(true); setPricesBusy(true); setPlacesError(""); setPricesError("");
    setPlaces([]); setReport(null); setSelectedId(null); setBaselineId(""); setRoad(null);
    const common = `area=${area}&radius=${radius}${originQuery(origin)}`;
    void fetch(`/api/live/places?${common}&kind=fuel`, { signal, cache: "no-store" })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Stations could not load."); return data as { places: NearbyPlace[] }; })
      .then((data) => { if (!controller.signal.aborted) setPlaces(data.places.filter((place) => place.kind === "fuel")); })
      .catch((error) => { if (!controller.signal.aborted) setPlacesError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Station search timed out. Try again."); })
      .finally(() => { if (!controller.signal.aborted) setPlacesBusy(false); });
    void fetch(`/api/live/local-fuel?${common}&type=${grade}`, { signal, cache: "no-store" })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Gas price unavailable."); return data as LocalFuelResult; })
      .then((data) => { if (!controller.signal.aborted) setReport(data); })
      .catch((error) => { if (!controller.signal.aborted) setPricesError(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Gas price lookup timed out."); })
      .finally(() => { if (!controller.signal.aborted) setPricesBusy(false); });
    return () => controller.abort();
  }, [origin?.lat, origin?.lon, area, radius, grade, attempt]);

  // Discovery and price lookup may return different capped result sets. Merge
  // them by Place ID so a reported station is not silently lost from the map.
  const mappedPlaces = useMemo(() => {
    const found = new Map<string, NearbyPlace>(places.map((place) => [place.id, place]));
    if (report) for (const station of report.stations) if (!found.has(station.id)) found.set(station.id, {
      id: station.id, name: station.name, kind: "fuel", address: station.address,
      lat: station.lat, lon: station.lon, miles: station.miles, mapUrl: station.mapUrl,
      attributions: station.attributions,
    });
    return deduplicatePhysicalStations([...found.values()].sort((a, b) => a.miles - b.miles),
      (place) => !!report && stationPriceForPlace(report, place.id, place.lat, place.lon)?.dollarsPerGallon != null);
  }, [places, report]);
  const priceFor = (place: NearbyPlace) => report && stationPriceForPlace(report, place.id, place.lat, place.lon);
  const priced = mappedPlaces.filter((place) => priceFor(place)?.dollarsPerGallon != null);
  const selected = mappedPlaces.find((place) => place.id === selectedId) ?? null;
  const baseline = mappedPlaces.find((place) => place.id === baselineId) ?? priced[0] ?? null;
  const selectedPrice = selected && priceFor(selected);
  const baselinePrice = baseline && priceFor(baseline);
  const stations = mappedPlaces.filter((place) => `${place.name} ${place.address}`.toLowerCase().includes(query.trim().toLowerCase()) &&
    (!favoritesOnly || favorites.includes(place.id))).sort((a, b) => sort === "price"
      ? (priceFor(a)?.dollarsPerGallon ?? Infinity) - (priceFor(b)?.dollarsPerGallon ?? Infinity) || a.miles - b.miles
      : a.miles - b.miles);
  const cheapest = [...priced].sort((a, b) => (priceFor(a)?.dollarsPerGallon ?? Infinity) - (priceFor(b)?.dollarsPerGallon ?? Infinity))[0];

  useEffect(() => {
    setDetails(null); setDetailsError("");
    if (!selectedId) return;
    const controller = new AbortController();
    void fetch(`/api/gas/details?id=${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error || "Station details unavailable."); return data.details as Details; })
      .then((data) => { if (!controller.signal.aborted && data.id === selectedId) setDetails(data); })
      .catch((error) => { if (!controller.signal.aborted) setDetailsError(error instanceof Error ? error.message : "Station details unavailable."); });
    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    setRoad(null); setRoadError("");
    if (!origin || cartStoreCount > 3 || !selected || !baseline || !selectedPrice?.dollarsPerGallon || !baselinePrice?.dollarsPerGallon) return;
    const controller = new AbortController();
    const storeIds = cartStores.map((store) => store.id);
    const points = [origin, ...cartStores, baseline, selected].map(({ lat, lon }) => ({ lat, lon }));
    setRoadBusy(true);
    void fetch("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matrix: true, points }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) })
      .then(async (response) => { if (!response.ok) throw new Error("Road routing is unavailable."); return response.json() as Promise<{ distances: (number | null)[][] }> })
      .then(({ distances }) => {
        if (controller.signal.aborted) return;
        const base = milesFromRoadMatrix(distances, storeIds, null);
        const first = milesFromRoadMatrix(distances, storeIds, storeIds.length + 1);
        const second = milesFromRoadMatrix(distances, storeIds, storeIds.length + 2);
        if (base === null || first === null || second === null) throw new Error("No complete driving route was found.");
        setRoad({ base, baseline: first, selected: second });
      }).catch((error) => { if (!controller.signal.aborted) setRoadError(error instanceof Error ? error.message : "Road routing is unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setRoadBusy(false); });
    return () => controller.abort();
  }, [origin?.lat, origin?.lon, selected?.id, baseline?.id, selectedPrice?.dollarsPerGallon, baselinePrice?.dollarsPerGallon, cartStores, cartStoreCount]);

  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(`gas-station-${selectedId}`)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  const savings = road && selectedPrice?.dollarsPerGallon && baselinePrice?.dollarsPerGallon
    ? calculateGasSavings({ gallonsNeeded: gallons, mpg, baselinePrice: baselinePrice.dollarsPerGallon,
      alternativePrice: selectedPrice.dollarsPerGallon, drivingFuelPrice: selectedPrice.dollarsPerGallon,
      baselineRouteMiles: road.baseline, alternativeRouteMiles: road.selected,
      noGasRouteMiles: road.base, maxDetourMiles: maxDetour }) : null;

  async function searchLocation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); locationRequest.current?.abort();
    const controller = new AbortController(); locationRequest.current = controller;
    const sequence = ++locationSequence.current;
    setLocationBusy(true); setLocationError("");
    try { const response = await fetch(`/api/gas/location?q=${encodeURIComponent(locationInput.trim())}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Location not found.");
      if (sequence === locationSequence.current) setOrigin(data.origin as SearchOrigin);
    } catch (error) { if (sequence === locationSequence.current) setLocationError(error instanceof Error ? error.message : "Location not found."); }
    finally { if (sequence === locationSequence.current) { setLocationBusy(false); locationRequest.current = null; } }
  }
  async function useMyLocation() {
    locationRequest.current?.abort();
    const controller = new AbortController(); locationRequest.current = controller;
    const sequence = ++locationSequence.current;
    setLocationError("");
    setLocationBusy(true);
    try {
      const detected = await detectDeviceLocation(controller.signal);
      if (sequence === locationSequence.current) setOrigin(detected);
    } catch (error) {
      if (sequence === locationSequence.current)
        setLocationError(`${error instanceof Error ? error.message : "Could not get your location."} Enter a ZIP or address to search.`);
    } finally {
      if (sequence === locationSequence.current) { setLocationBusy(false); locationRequest.current = null; }
    }
  }
  function chooseStation(place: NearbyPlace) {
    if (!draft) return;
    const price = priceFor(place);
    const reported = price?.dollarsPerGallon != null && !!price.updatedAt;
    const next: CheckoutDraft = { ...draft, origin: origin ?? draft.origin,
      ipArea: origin ? origin.source === "device" : draft.ipArea,
      gasGallonsNeeded: Number.isFinite(gallons) && gallons > 0 && gallons <= 100 ? gallons : undefined,
      gasStop: { id: place.id, name: place.name, address: place.address,
      lat: place.lat, lon: place.lon, mapUrl: place.mapUrl },
      fuelSource: reported ? { kind: "station", stationName: place.name, fuelType: grade,
        dollarsPerGallon: price.dollarsPerGallon!, period: price.updatedAt!, retrievedAt: report!.retrievedAt,
        sourceUrl: place.mapUrl, region: place.address } : null,
      prefs: { ...draft.prefs, gas: reported ? price.dollarsPerGallon! : draft.manualGas } };
    if (writeCheckoutDraft(sessionStorage, next)) setDraft(next);
  }
  function updateGallons(value: number) {
    setGallons(value);
    if (!draft?.gasStop) return;
    const next = { ...draft, gasGallonsNeeded: Number.isFinite(value) && value > 0 && value <= 100 ? value : undefined };
    if (writeCheckoutDraft(sessionStorage, next)) setDraft(next);
  }
  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((value) => value !== id) : [...favorites, id];
    setFavorites(next); try { localStorage.setItem("stretch.preferred-gas-stations", JSON.stringify(next)); } catch { /* Session preference still works. */ }
  }
  const directions = selected && origin ? (() => { const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1"); url.searchParams.set("origin", `${origin.lat},${origin.lon}`);
    url.searchParams.set("destination", `${selected.lat},${selected.lon}`);
    url.searchParams.set("destination_place_id", selected.id); url.searchParams.set("travelmode", "driving"); return url.toString(); })() : null;

  return <main className="gas-workspace">
    <header className="gas-workspace-heading"><div><p className="eyebrow">GROCERIES + GAS, ONE ROUTE</p><h1>Find your gas stop</h1>
      <p>See nearby stations, check recent pump reports, and decide whether a detour pays off.</p></div>
      <Link href={back}>← Back to {back === "/cart" ? "Smart Cart" : "Stores & Gas"}</Link></header>
    <div className="gas-workspace-grid">
      <section className="gas-workspace-filters" aria-label="Gas search controls">
        <h2>Where are you starting?</h2>
        <form onSubmit={(event) => void searchLocation(event)} className="gas-location-form"><label htmlFor="gas-location">ZIP code or address</label>
          <div><input id="gas-location" value={locationInput} onChange={(event) => setLocationInput(event.target.value)} placeholder="30303 or street address" />
            <button type="submit" disabled={locationBusy}>Search</button></div></form>
        <button className="gas-location-button" type="button" disabled={locationBusy} onClick={useMyLocation}>Use my location</button>
        {locationBusy && <p role="status">Finding your location…</p>}
        {locationError && <p role="alert">{locationError}</p>}
        {origin && <p className="gas-origin">Searching near <strong>{origin.label}</strong></p>}
        <div className="gas-field-grid"><label>Fuel grade <select value={grade} onChange={(event) => setGrade(event.target.value as FuelType)}>
          {grades.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
          <label>Search radius <select value={radius} onChange={(event) => setRadius(Number(event.target.value))}>
            {[1, 2, 3, 5, 10].map((value) => <option key={value} value={value}>{value} miles</option>)}</select></label>
          <label>Sort stations <select value={sort} onChange={(event) => setSort(event.target.value as "distance" | "price")}>
            <option value="distance">Nearest first</option><option value="price">Lowest reported price</option></select></label>
          <label>Find a station <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or address" /></label></div>
        <label className="gas-favorites-filter"><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /> Preferred stations only</label>
        <button type="button" className="gas-refresh" onClick={() => setAttempt((value) => value + 1)} disabled={placesBusy || pricesBusy}>Refresh stations</button>
        {sort === "price" && !priced.length && <p className="small">No current reports for this grade. Stations remain ordered by distance.</p>}
        <div className="gas-station-scroll" aria-label="Nearby gas stations">
          {(placesBusy || pricesBusy) && <p role="status">{placesBusy ? "Finding nearby stations…" : "Checking reported prices…"}</p>}
          {placesError && <p role="alert">{placesError}</p>}
          {pricesError && <p role="status">Gas price unavailable. {pricesError}</p>}
          {!placesBusy && !placesError && !mappedPlaces.length && <p>No gas stations found within {radius} miles. Try a wider radius.</p>}
          {mappedPlaces.length > 0 && !stations.length && <p>No stations match these filters.</p>}
          {stations.map((place) => {
            const price = priceFor(place);
            return <div key={place.id} id={`gas-station-${place.id}`} className={`gas-station-row${selectedId === place.id ? " selected" : ""}`}>
              <button type="button" className="gas-station-open" aria-pressed={selectedId === place.id} onClick={() => setSelectedId(place.id)}>
                <strong>{place.name}</strong><small>{place.address || "Address unavailable"}</small>
                <span>{place.miles.toFixed(1)} mi straight-line · {price?.dollarsPerGallon != null ? `$${price.dollarsPerGallon.toFixed(3)}/gal reported` : "Gas price unavailable"}</span>
              </button>
              <button type="button" className="gas-favorite" aria-label={`${favorites.includes(place.id) ? "Remove" : "Add"} ${place.name} ${favorites.includes(place.id) ? "from" : "to"} preferred stations`}
                aria-pressed={favorites.includes(place.id)} onClick={() => toggleFavorite(place.id)}>{favorites.includes(place.id) ? "★" : "☆"}</button>
            </div>;
          })}
        </div>
      </section>
      <section className="gas-workspace-map" aria-label="Gas station map">
        <div className="gas-panel-heading"><h2>Stations around you</h2><span>{mappedPlaces.length} mapped</span></div>
        {origin ? <OpenMap area={area} origin={origin} radius={radius} places={mappedPlaces} fuelOnly
          selectedPlaceId={selectedId} onSelectPlace={(place) => setSelectedId(place.id)} /> : <p>Choose a starting location to see the map.</p>}
      </section>
      <aside className="gas-workspace-details" aria-label="Selected station details">
        {!selected ? <><h2>Pick a station</h2><p>Select a map marker or a station on the left to see its details.</p></> : <>
          <p className="eyebrow">SELECTED GAS STOP</p><h2>{selected.name}</h2><p>{selected.address || "Address unavailable"}</p>
          <p className="gas-detail-price">{selectedPrice?.dollarsPerGallon != null ? `$${selectedPrice.dollarsPerGallon.toFixed(3)} / gallon` : "Gas price unavailable"}</p>
          <p className="small">{selectedPrice?.dollarsPerGallon != null
            ? `${grades.find((item) => item.value === grade)?.label} · ${selectedPrice.source} · checked ${new Date(selectedPrice.updatedAt!).toLocaleString()}`
            : "No recent report for this fuel grade. Your entered fuel estimate stays separate from station prices."}</p>
          {cheapest?.id === selected.id && <p className="gas-cheapest">Lowest reported {grades.find((item) => item.value === grade)?.label.toLowerCase()} price among these results</p>}
          {detailsError && <p className="small" role="status">{detailsError}</p>}
          {details && <div className="gas-detail-facts">
            {details.businessStatus && <p>Status: {details.businessStatus.replaceAll("_", " ").toLowerCase()}</p>}
            {details.currentOpeningHours?.openNow !== undefined && <p>{details.currentOpeningHours.openNow ? "Open now" : "Closed now"}</p>}
            {details.rating !== undefined && <p>Google rating: {details.rating.toFixed(1)} / 5</p>}
            {details.nationalPhoneNumber && <p><a href={`tel:${details.nationalPhoneNumber}`}>{details.nationalPhoneNumber}</a></p>}
            {details.websiteUri && <p><a href={details.websiteUri} target="_blank" rel="noreferrer">Station website ↗</a></p>}
            {details.attributions?.map((credit) => credit.providerUri && <p key={credit.providerUri}><a href={credit.providerUri} target="_blank" rel="noreferrer">{credit.provider}</a></p>)}
          </div>}
          <div className="gas-detail-actions"><button type="button" onClick={() => chooseStation(selected)} aria-pressed={draft?.gasStop?.id === selected.id} disabled={!draft}>
            {draft?.gasStop?.id === selected.id ? "Added to trip ✓" : "Add gas stop to trip"}</button>
            {directions && <a href={directions} target="_blank" rel="noreferrer">Driving directions ↗</a>}</div>
          {!draft && <p className="small">Start a grocery list to save this station to a trip. <Link href="/plan">Build your list ↗</Link></p>}
          <section className="gas-savings-panel" aria-label="Gas detour calculator"><h3>Is the detour worth it?</h3>
            <p>Compare this station with another reported station on the same grocery route.</p>
            <label>Compare against <select value={baseline?.id ?? ""} onChange={(event) => setBaselineId(event.target.value)} disabled={!priced.length}>
              {!priced.length && <option value="">No reported prices</option>}
              {priced.map((place) => <option key={place.id} value={place.id}>{place.name} · {place.miles.toFixed(1)} mi</option>)}</select></label>
            <div className="gas-savings-fields"><label>Gallons needed <input type="number" min="0.1" max="100" step="0.1" value={gallons} onChange={(event) => updateGallons(Number(event.target.value))} /></label>
              <label>Vehicle MPG <input type="number" min="1" max="200" step="0.1" value={mpg} onChange={(event) => setMpg(Number(event.target.value))} /></label>
              <label>Max detour (mi) <input type="number" min="0" max="100" step="0.1" value={maxDetour} onChange={(event) => setMaxDetour(Number(event.target.value))} /></label></div>
            {cartStoreCount > 3 && <p role="status">This calculator supports up to three grocery stops. Remove a store from the cart to compare routes.</p>}
            {roadBusy && <p role="status">Calculating road distances…</p>}
            {roadError && <p role="status">{roadError} Savings cannot be calculated yet.</p>}
            {savings ? <div className="gas-savings-result">
              <p>Fuel purchase <strong>{money(savings.baselinePurchaseCents)} → {money(savings.alternativePurchaseCents)}</strong></p>
              <p>Route change <strong>{savings.additionalRouteMiles.toFixed(1)} road mi</strong></p>
              <p>Estimated driving fuel difference <strong>{money(savings.additionalDrivingFuelCents)}</strong></p>
              <p className="gas-savings-net">Estimated net {savings.netSavingsCents >= 0 ? "savings" : "extra cost"} <strong>{money(Math.abs(savings.netSavingsCents))}</strong></p>
              {!savings.withinDistanceLimit && <p role="status">This stop exceeds your {maxDetour}-mile detour limit.</p>}
              {savings.netSavingsCents <= 0 && <p>Switching stations does not save money on this route.</p>}
            </div> : !roadBusy && <p className="small">Two recent station prices and a road route are needed to calculate net savings.</p>}
            <p className="small">Estimates use reported pump prices, entered gallons and MPG, and road distances. They do not confirm the price at the pump.</p>
          </section>
        </>}
        {draft?.gasStop && <p className="gas-added" role="status">Trip stop: {draft.gasStop.name}. <Link href={back}>Continue your trip →</Link></p>}
        <p className="gas-attribution">Station data and map: Google Maps. Nearby Search returns a limited set of results; prices may be missing or outdated.</p>
      </aside>
    </div>
  </main>;
}
