"use client";

import { useEffect, useRef, useState } from "react";
import RouteDirections, { type DirectionStep } from "./RouteDirections";
import { centers, type SearchOrigin } from "@/lib/locations";
import type { Area, NearbyPlace } from "@/lib/live-data";
import { fetchMapRoadRoute, groceryRoutePlaces, loadGroceryMapRoutes, roadRouteKey,
  storeDirectionsUrl, type GroceryMapRoute, type MapRoadRoute } from "@/lib/grocery-map-routes";

let loaderReady: Promise<google.maps.MapsLibrary> | null = null;
function loadMaps() {
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
  if (!key) return Promise.reject(new Error("Google map browser key is not configured."));
  if (!loaderReady) loaderReady = import("@googlemaps/js-api-loader").then(({ setOptions, importLibrary }) => {
    setOptions({ key, v: "weekly" });
    return importLibrary("maps") as Promise<google.maps.MapsLibrary>;
  }).catch((error) => { loaderReady = null; throw error; });
  return loaderReady;
}

function fullscreenRouteZoom(bounds: google.maps.LatLngBounds, width: number, height: number) {
  const northEast = bounds.getNorthEast(), southWest = bounds.getSouthWest();
  const mercatorY = (latitude: number) => Math.asinh(Math.tan(latitude * Math.PI / 180)) / (2 * Math.PI);
  const xSpan = Math.max((northEast.lng() - southWest.lng()) / 360, 1e-6);
  const ySpan = Math.max(mercatorY(northEast.lat()) - mercatorY(southWest.lat()), 1e-6);
  const available = Math.min((width - 96) / (256 * xSpan), (height - 96) / (256 * ySpan));
  return Math.max(11, Math.min(18, Math.floor(Math.log2(Math.max(1, available)))));
}

export default function OpenMap({ area, radius, places, routePlaces = places, origin, onSelectFuel, onSelectPlace, selectedFuelId, selectedPlaceId, selectedPlaceIds, fuelOnly = false, showGroceryRoutes = !fuelOnly }: {
  area: Area; radius: number; places: NearbyPlace[]; routePlaces?: NearbyPlace[]; origin?: SearchOrigin | null;
  onSelectFuel?: (place: NearbyPlace) => void; onSelectPlace?: (place: NearbyPlace) => void;
  selectedFuelId?: string | null; selectedPlaceId?: string | null; selectedPlaceIds?: string[]; fuelOnly?: boolean; showGroceryRoutes?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const selectedCallback = useRef(onSelectFuel);
  selectedCallback.current = onSelectFuel;
  const placeCallback = useRef(onSelectPlace);
  placeCallback.current = onSelectPlace;
  const [error, setError] = useState("");
  const [roadRoute, setRoadRoute] = useState<{ miles: number; minutes: number; stops: string[] } | null>(null);
  const [routeError, setRouteError] = useState("");
  const [directionSteps, setDirectionSteps] = useState<DirectionStep[]>([]);
  const [routeView, setRouteView] = useState<"all" | "trip">("trip");
  const [mapVersion, setMapVersion] = useState(0);
  const mapForRoutes = useRef<google.maps.Map | null>(null);
  const routeCache = useRef(new Map<string, MapRoadRoute>());
  const [routeAttempt, setRouteAttempt] = useState(0);
  const [groceryRoutes, setGroceryRoutes] = useState<{ key: string; entries: Record<string, GroceryMapRoute> }>({ key: "", entries: {} });
  const selectedIds = selectedPlaceIds ?? (selectedPlaceId ? [selectedPlaceId] : []);
  const selectedKey = selectedIds.join("|");
  useEffect(() => { setRouteView("trip"); }, [selectedKey]);
  const selectedStores = selectedIds.map((id) => routePlaces.find((place) => place.kind === "grocery" && place.id === id))
    .filter((place): place is NearbyPlace => !!place);
  const selectedFuel = routePlaces.find((place) => place.kind === "fuel" && place.id === selectedFuelId);
  const routeStops = [...selectedStores, selectedFuel].filter((place): place is NearbyPlace => !!place);
  const center = origin ?? centers[area];
  const groceries = groceryRoutePlaces(routePlaces);
  const allRoutesKey = `${center.lat},${center.lon}:${groceries.map(({ id, lat, lon }) => `${id}:${lat},${lon}`).join("|")}`;
  const entries = groceryRoutes.key === allRoutesKey ? groceryRoutes.entries : {};
  const loadedCount = Object.values(entries).filter((entry) => entry.status === "completed").length;
  const failedCount = Object.values(entries).filter((entry) => entry.status === "error").length;
  const pendingCount = groceries.length - loadedCount - failedCount;
  const showAllRoutes = showGroceryRoutes && routeView === "all";
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  useEffect(() => {
    if (!showAllRoutes) return;
    const controller = new AbortController();
    setGroceryRoutes({ key: allRoutesKey, entries: {} });
    void loadGroceryMapRoutes(center, groceries, { signal: controller.signal, cache: routeCache.current,
      onResult: (entry) => {
        if (controller.signal.aborted) return;
        setGroceryRoutes((state) => state.key === allRoutesKey
          ? { key: allRoutesKey, entries: { ...state.entries, [entry.place.id]: entry } } : state);
      } });
    return () => controller.abort();
  }, [allRoutesKey, showAllRoutes, routeAttempt]);
  const directionsUrl = routeStops.length ? (() => {
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", `${center.lat},${center.lon}`);
    url.searchParams.set("destination", `${center.lat},${center.lon}`);
    url.searchParams.set("waypoints", routeStops.map((stop) => `${stop.lat},${stop.lon}`).join("|"));
    url.searchParams.set("travelmode", "driving");
    return url.toString();
  })() : null;
  useEffect(() => {
    let cancelled = false;
    const routeController = new AbortController();
    setDirectionSteps([]);
    const markers: google.maps.Marker[] = [];
    let circle: google.maps.Circle | null = null;
    let map: google.maps.Map | null = null;
    let roadLine: google.maps.Polyline | null = null;
    let routeBounds: google.maps.LatLngBounds | null = null;
    let resizeObserver: ResizeObserver | null = null;
    const fitRouteAfterResize = () => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (cancelled || !map || !routeBounds) return;
      const fullscreen = document.fullscreenElement;
      if (fullscreen && container.current?.contains(fullscreen)) {
        const { width, height } = fullscreen.getBoundingClientRect();
        map.panTo(routeBounds.getCenter());
        map.setZoom(fullscreenRouteZoom(routeBounds, width, height));
      } else {
        map.fitBounds(routeBounds, 48);
      }
    }));
    document.addEventListener("fullscreenchange", fitRouteAfterResize);
    setError("");
    setRoadRoute(null);
    setRouteError("");
    void loadMaps().then(({ Map, InfoWindow }) => {
      if (cancelled || !container.current) return;
      map = new Map(container.current, { center: { lat: center.lat, lng: center.lon }, zoom: 12,
        scrollwheel: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: true, zoomControl: true });
      mapForRoutes.current = map;
      setMapVersion((version) => version + 1);
      resizeObserver = new ResizeObserver(fitRouteAfterResize);
      resizeObserver.observe(container.current);
      if (container.current.firstElementChild) resizeObserver.observe(container.current.firstElementChild);
      circle = new google.maps.Circle({ map, center: { lat: center.lat, lng: center.lon },
        radius: radius * 1609.344, strokeColor: "#61752a", strokeOpacity: .8,
        fillColor: "#a6b68b", fillOpacity: .12 });
      map.fitBounds(circle.getBounds()!);
      if (showAllRoutes) routeBounds = circle.getBounds();
      const info = new InfoWindow();
      const centerMarker = new google.maps.Marker({ map, position: { lat: center.lat, lng: center.lon },
        title: "Starting area" });
      markers.push(centerMarker);
      const seen = new Set<string>();
      for (const place of places) {
        if (seen.has(place.id)) continue;
        seen.add(place.id);
        const selectedIndex = selectedIds.indexOf(place.id);
        const active = place.id === selectedFuelId || selectedIndex >= 0;
        const marker = new google.maps.Marker({ map, position: { lat: place.lat, lng: place.lon },
          title: `${place.name} · ${place.address}`, label: showAllRoutes || active || !routeStops.length ? { text: place.kind === "fuel" ? "G" : selectedIndex >= 0 ? String(selectedIndex + 1) : "S", color: "#fffaf0" } : undefined,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: active ? 14 : showAllRoutes ? 9 : routeStops.length ? 7 : 11,
            fillColor: place.kind === "fuel" ? "#c7563e" : "#61752a", fillOpacity: showAllRoutes || active || !routeStops.length ? 1 : 0.45,
            strokeColor: "#302d26", strokeWeight: active ? 3 : 1.5 } });
        marker.addListener("click", () => {
          const content = document.createElement("div");
          const name = document.createElement("strong"), address = document.createElement("p"), link = document.createElement("a");
          name.textContent = place.name;
          address.textContent = `${place.address || "Address not listed"} · ${place.miles} miles from start`;
          link.href = storeDirectionsUrl(center, place); link.target = "_blank"; link.rel = "noreferrer";
          link.textContent = "Driving directions ↗";
          content.append(name, address, link);
          const storeRoute = entriesRef.current[place.id]?.route;
          if (storeRoute) {
            const distance = document.createElement("p");
            distance.textContent = `${storeRoute.miles.toFixed(1)} road miles · about ${Math.round(storeRoute.minutes)} min from start`;
            content.append(distance);
          }
          if (place.kind === "grocery" && placeCallback.current) {
            const button = document.createElement("button"); button.type = "button";
            button.textContent = selectedIds.includes(place.id) ? "Remove from my trip" : "Add to my trip";
            button.addEventListener("click", () => placeCallback.current?.(place)); content.append(button);
          }
          for (const credit of place.attributions ?? []) {
            const a = document.createElement("a"); a.href = credit.url; a.target = "_blank";
            a.rel = "noreferrer"; a.textContent = ` · ${credit.name}`; content.append(a);
          }
          if (place.kind === "fuel" && selectedCallback.current) {
            const button = document.createElement("button"); button.type = "button";
            button.textContent = selectedFuelId === place.id ? "Selected gas stop ✓" : "Choose gas stop";
            button.addEventListener("click", () => selectedCallback.current?.(place)); content.append(button);
          }
          info.setContent(content); info.open({ map, anchor: marker });
        });
        markers.push(marker);
        if (!showAllRoutes && place.id === selectedIds.at(-1)) map.panTo({ lat: place.lat, lng: place.lon });
      }
      if (routeStops.length) {
        const tripPoints = [center, ...routeStops, center];
        const key = roadRouteKey(tripPoints);
        void (routeCache.current.has(key) ? Promise.resolve(routeCache.current.get(key)!)
          : fetchMapRoadRoute(tripPoints, routeController.signal)).then((route) => {
          if (cancelled || !map || !route.geometry?.coordinates?.length) return;
          routeCache.current.set(key, route);
          const path = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lng: lon }));
          roadLine = new google.maps.Polyline({ map, path, strokeColor: "#e26b44", strokeOpacity: 1, strokeWeight: 7, zIndex: 3 });
          if (!showAllRoutes) {
            routeBounds = new google.maps.LatLngBounds();
            path.forEach((point) => routeBounds!.extend(point));
            fitRouteAfterResize();
          }
          setRoadRoute({ miles: route.miles, minutes: route.minutes, stops: routeStops.map((stop) => stop.name) });
          setDirectionSteps(route.steps ?? []);
        }).catch(() => { if (!routeController.signal.aborted) setRouteError("Road route could not load. Open directions in Google Maps instead."); });
      }
    }).catch(() => { if (!cancelled) setError("The Google map could not load. Use the location links below."); });
    return () => { cancelled = true; resizeObserver?.disconnect(); document.removeEventListener("fullscreenchange", fitRouteAfterResize);
      routeController.abort(); markers.forEach((marker) => marker.setMap(null)); circle?.setMap(null);
      roadLine?.setMap(null);
      mapForRoutes.current = null;
      if (map) google.maps.event.clearInstanceListeners(map); };
  }, [area, radius, places, origin?.lat, origin?.lon, selectedFuelId, selectedKey, showAllRoutes]);
  useEffect(() => {
    const map = mapForRoutes.current;
    if (!map || !showAllRoutes) return;
    const lines = Object.values(entries).flatMap((entry) => entry.route ? [new google.maps.Polyline({
      map, path: entry.route.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
      strokeColor: "#61752a", strokeOpacity: .72, strokeWeight: 4, zIndex: 1, clickable: false,
    })] : []);
    return () => lines.forEach((line) => line.setMap(null));
  }, [mapVersion, groceryRoutes, allRoutesKey, showAllRoutes]);
  return <>
    {showGroceryRoutes && <div className="map-route-views" role="group" aria-label="Driving route view">
      <button type="button" aria-pressed={routeView === "all"} onClick={() => setRouteView("all")}>All grocery routes</button>
      <button type="button" aria-pressed={routeView === "trip"} disabled={!routeStops.length} onClick={() => setRouteView("trip")}>My trip</button>
    </div>}
    <div className="osm-map" ref={container} aria-label={`Google Map: locations within ${radius} miles of ${origin?.label ?? area}`} />
    <p className="map-caption">{fuelOnly ? "Red: gas stations" : "Green: grocery routes · Red: gas"}{roadRoute ? " · Orange: your trip" : ""} · Map by Google Maps</p>
    {showAllRoutes && groceries.length > 0 && <>
      <p className="map-route-status" role="status">{pendingCount > 0
        ? `Drawing grocery routes · ${loadedCount} of ${groceries.length} ready`
        : `${loadedCount} of ${groceries.length} grocery driving routes ${showAllRoutes ? "shown" : "available"}`}{failedCount > 0 ? ` · ${failedCount} could not load` : ""}.</p>
      {failedCount > 0 && <button type="button" className="map-route-retry" onClick={() => setRouteAttempt((value) => value + 1)}>Retry missing routes</button>}
      <details className="map-grocery-routes">
        <summary>Driving time to each store · {groceries.length}</summary>
        <ul>{groceries.map((place) => <li key={place.id}>
          <strong>{place.name}</strong><small>{place.address}</small>
          <span>{entries[place.id]?.route
            ? `${entries[place.id].route!.miles.toFixed(1)} road mi · ~${Math.round(entries[place.id].route!.minutes)} min one way`
            : entries[place.id]?.status === "error" ? "Route could not load" : "Finding road route…"}</span>
          <a href={storeDirectionsUrl(center, place)} target="_blank" rel="noreferrer">Directions ↗</a>
        </li>)}</ul>
      </details>
    </>}
      {roadRoute && <p className="map-route-preview" role="status">Road route preview: starting area → {roadRoute.stops.join(" → ")} → starting area · {roadRoute.miles.toFixed(1)} miles · about {Math.round(roadRoute.minutes)} minutes. Selected map stops do not confirm grocery prices.</p>}
    {roadRoute && !showAllRoutes && <RouteDirections steps={directionSteps} onStep={(step) => {
      if (Number.isFinite(step.lat) && Number.isFinite(step.lon)) {
        mapForRoutes.current?.panTo({ lat: step.lat!, lng: step.lon! }); mapForRoutes.current?.setZoom(17);
      }
    }} />}
    {directionsUrl && <a className="map-route-directions" href={directionsUrl} target="_blank" rel="noreferrer">Continue in Google Maps ↗</a>}
    {routeError && <p role="status">{routeError}</p>}
    {error && <p role="status">{error}</p>}</>;
}
