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

export default function OpenMap({ area, radius, places, origin, onSelectFuel, onSelectPlace, selectedFuelId, selectedPlaceId, fuelOnly = false }: {
  area: Area; radius: number; places: NearbyPlace[]; origin?: SearchOrigin | null;
  onSelectFuel?: (place: NearbyPlace) => void; onSelectPlace?: (place: NearbyPlace) => void;
  selectedFuelId?: string | null; selectedPlaceId?: string | null; fuelOnly?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const selectedCallback = useRef(onSelectFuel);
  selectedCallback.current = onSelectFuel;
  const placeCallback = useRef(onSelectPlace);
  placeCallback.current = onSelectPlace;
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const markers: google.maps.Marker[] = [];
    let circle: google.maps.Circle | null = null;
    let map: google.maps.Map | null = null;
    setError("");
    void loadMaps().then(({ Map, InfoWindow }) => {
      if (cancelled || !container.current) return;
      const center = origin ?? centers[area];
      map = new Map(container.current, { center: { lat: center.lat, lng: center.lon }, zoom: 12,
        scrollwheel: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: true, zoomControl: true });
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
          title: `${place.name} · ${place.address}`, label: { text: place.kind === "fuel" ? "G" : "S", color: "#fffaf0" },
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: active ? 14 : 11,
            fillColor: place.kind === "fuel" ? "#c7563e" : "#61752a", fillOpacity: 1,
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
        if (place.id === selectedPlaceId) { map.panTo({ lat: place.lat, lng: place.lon }); google.maps.event.trigger(marker, "click"); }
      }
    }).catch(() => { if (!cancelled) setError("The Google map could not load. Use the location links below."); });
    return () => { cancelled = true; markers.forEach((marker) => marker.setMap(null)); circle?.setMap(null);
      if (map) google.maps.event.clearInstanceListeners(map); };
  }, [area, radius, places, origin?.lat, origin?.lon, selectedFuelId, selectedPlaceId]);
  return <><div className="osm-map" ref={container} aria-label={`Google Map: locations within ${radius} miles of ${origin?.label ?? area}`} />
    <p className="map-caption">{fuelOnly ? "Red: gas stations" : "Green: groceries · Red: gas"} · Circle: search radius · Map by Google Maps</p>
    {error && <p role="status">{error}</p>}</>;
}
