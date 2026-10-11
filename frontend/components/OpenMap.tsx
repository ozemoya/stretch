"use client";

import { useEffect, useRef, useState } from "react";
import { centers, type SearchOrigin } from "@/lib/locations";
import type { Area, NearbyPlace } from "@/lib/live-data";

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

export default function OpenMap({ area, radius, places, routePlaces = places, origin, onSelectFuel, onSelectPlace, selectedFuelId, selectedPlaceId, fuelOnly = false }: {
  area: Area; radius: number; places: NearbyPlace[]; routePlaces?: NearbyPlace[]; origin?: SearchOrigin | null;
  onSelectFuel?: (place: NearbyPlace) => void; onSelectPlace?: (place: NearbyPlace) => void;
  selectedFuelId?: string | null; selectedPlaceId?: string | null; fuelOnly?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const selectedCallback = useRef(onSelectFuel);
  selectedCallback.current = onSelectFuel;
  const placeCallback = useRef(onSelectPlace);
  placeCallback.current = onSelectPlace;
  const [error, setError] = useState("");
  const [roadRoute, setRoadRoute] = useState<{ miles: number; minutes: number; stops: string[] } | null>(null);
  const [routeError, setRouteError] = useState("");
  const selectedStore = routePlaces.find((place) => place.kind !== "fuel" && place.id === selectedPlaceId);
  const selectedFuel = routePlaces.find((place) => place.kind === "fuel" && place.id === selectedFuelId);
  const routeStops = [selectedStore, selectedFuel].filter((place): place is NearbyPlace => !!place);
  const center = origin ?? centers[area];
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
      resizeObserver = new ResizeObserver(fitRouteAfterResize);
      resizeObserver.observe(container.current);
      if (container.current.firstElementChild) resizeObserver.observe(container.current.firstElementChild);
      circle = new google.maps.Circle({ map, center: { lat: center.lat, lng: center.lon },
        radius: radius * 1609.344, strokeColor: "#61752a", strokeOpacity: .8,
        fillColor: "#a6b68b", fillOpacity: .12 });
      map.fitBounds(circle.getBounds()!);
      const info = new InfoWindow();
      const centerMarker = new google.maps.Marker({ map, position: { lat: center.lat, lng: center.lon },
        title: "Starting area" });
      markers.push(centerMarker);
      const seen = new Set<string>();
      for (const place of places) {
        if (seen.has(place.id)) continue;
        seen.add(place.id);
        const active = place.id === selectedFuelId || place.id === selectedPlaceId;
        const marker = new google.maps.Marker({ map, position: { lat: place.lat, lng: place.lon },
          title: `${place.name} · ${place.address}`, label: active || !routeStops.length ? { text: place.kind === "fuel" ? "G" : "S", color: "#fffaf0" } : undefined,
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: active ? 14 : routeStops.length ? 7 : 11,
            fillColor: place.kind === "fuel" ? "#c7563e" : "#61752a", fillOpacity: active || !routeStops.length ? 1 : 0.45,
            strokeColor: "#302d26", strokeWeight: active ? 3 : 1.5 } });
        marker.addListener("click", () => {
          placeCallback.current?.(place);
          const content = document.createElement("div");
          const name = document.createElement("strong"), address = document.createElement("p"), link = document.createElement("a");
          name.textContent = place.name;
          address.textContent = `${place.address || "Address not listed"} · ${place.miles} miles from start`;
          link.href = place.mapUrl; link.target = "_blank"; link.rel = "noreferrer";
          link.textContent = "View on Google Maps ↗";
          content.append(name, address, link);
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
        if (place.id === selectedPlaceId) map.panTo({ lat: place.lat, lng: place.lon });
      }
      if (routeStops.length) {
        void fetch("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: [center, ...routeStops, center].map(({ lat, lon }) => ({ lat, lon })) }),
          signal: routeController.signal }).then(async (response) => {
          if (!response.ok) throw new Error("Road route unavailable");
          return response.json() as Promise<{ miles: number; minutes: number; geometry?: { coordinates?: [number, number][] } }>;
        }).then((route) => {
          if (cancelled || !map || !route.geometry?.coordinates?.length) return;
          const path = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lng: lon }));
          roadLine = new google.maps.Polyline({ map, path, strokeColor: "#e26b44", strokeOpacity: 1, strokeWeight: 7 });
          routeBounds = new google.maps.LatLngBounds();
          path.forEach((point) => routeBounds!.extend(point));
          fitRouteAfterResize();
          setRoadRoute({ miles: route.miles, minutes: route.minutes, stops: routeStops.map((stop) => stop.name) });
        }).catch(() => { if (!routeController.signal.aborted) setRouteError("Road route could not load. Open directions in Google Maps instead."); });
      }
    }).catch(() => { if (!cancelled) setError("The Google map could not load. Use the location links below."); });
    return () => { cancelled = true; resizeObserver?.disconnect(); document.removeEventListener("fullscreenchange", fitRouteAfterResize);
      routeController.abort(); markers.forEach((marker) => marker.setMap(null)); circle?.setMap(null);
      roadLine?.setMap(null);
      if (map) google.maps.event.clearInstanceListeners(map); };
  }, [area, radius, places, origin?.lat, origin?.lon, selectedFuelId, selectedPlaceId]);
  return <><div className="osm-map" ref={container} aria-label={`Google Map: locations within ${radius} miles of ${origin?.label ?? area}`} />
    <p className="map-caption">{fuelOnly ? "Red: gas stations" : "Green: groceries · Red: gas"} · Circle: search radius · Map by Google Maps</p>
    {roadRoute && <p className="map-route-preview" role="status">Road route preview: starting area → {roadRoute.stops.join(" → ")} → starting area · {roadRoute.miles.toFixed(1)} miles · about {roadRoute.minutes} minutes. Selected map stops do not confirm grocery prices.</p>}
    {directionsUrl && <a className="map-route-directions" href={directionsUrl} target="_blank" rel="noreferrer">Open driving directions ↗</a>}
    {routeError && <p role="status">{routeError}</p>}
    {error && <p role="status">{error}</p>}</>;
}
