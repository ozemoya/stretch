"use client";

import { useEffect, useRef, useState } from "react";

type Point = { lat: number; lon: number; name?: string; label?: string; address?: string; summary?: string };

export default function CartRouteMap({ points, selectedIndex = 0, onSelect, roundTrip = true, onRoute }: {
  points: Point[]; selectedIndex?: number; onSelect?: (index: number) => void; roundTrip?: boolean;
  onRoute?: (route: { miles: number; minutes: number }) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [error, setError] = useState("");
  const key = JSON.stringify([roundTrip, points.map(({ lat, lon }) => [lat, lon])]);

  useEffect(() => {
    const browserKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY;
    if (!browserKey || !element.current) { setError("Map unavailable. Use the directions link above."); return; }
    const controller = new AbortController();
    let map: google.maps.Map | null = null;
    const markers: google.maps.Marker[] = [];
    let path: google.maps.Polyline | null = null;
    setError("");
    void Promise.all([
      import("@googlemaps/js-api-loader").then(({ setOptions, importLibrary }) => {
        setOptions({ key: browserKey, v: "weekly" });
        return importLibrary("maps") as Promise<google.maps.MapsLibrary>;
      }),
      fetch("/api/routes", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points: (roundTrip ? [...points, points[0]] : points).map(({ lat, lon }) => ({ lat, lon })) }),
        signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error("Route unavailable");
          return response.json() as Promise<{ miles?: number; minutes?: number; geometry?: { coordinates?: [number, number][] } }>;
        }),
    ]).then(([{ Map }, route]) => {
      if (controller.signal.aborted || !element.current || !route.geometry?.coordinates?.length) return;
      if (Number.isFinite(route.miles) && Number.isFinite(route.minutes))
        onRoute?.({ miles: route.miles!, minutes: route.minutes! });
      map = new Map(element.current, { center: { lat: points[0].lat, lng: points[0].lon }, zoom: 11,
        scrollwheel: false, streetViewControl: false, mapTypeControl: false });
      mapRef.current = map;
      const bounds = new google.maps.LatLngBounds();
      const routePoints = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lng: lon }));
      routePoints.forEach((point) => bounds.extend(point));
      path = new google.maps.Polyline({ map, path: routePoints, strokeColor: "#61752a",
        strokeOpacity: 0.95, strokeWeight: 5 });
      const info = new google.maps.InfoWindow();
      points.forEach((point, index) => {
        const marker = new google.maps.Marker({ map,
          position: { lat: point.lat, lng: point.lon }, title: point.name ?? point.label ?? "Starting area",
          label: index === 0 ? "H" : String(index) });
        marker.addListener("click", () => {
          const content = document.createElement("div");
          const title = document.createElement("strong"); title.textContent = point.name ?? point.label ?? "Start";
          content.append(title);
          for (const value of [point.address, point.summary]) if (value) {
            const detail = document.createElement("p"); detail.textContent = value; content.append(detail);
          }
          info.setContent(content); info.open({ anchor: marker, map });
          onSelect?.(index);
        });
        markers.push(marker);
      });
      markersRef.current = markers;
      map.fitBounds(bounds, 30);
    }).catch(() => { if (!controller.signal.aborted) setError("Route map unavailable. Use the directions link above."); });
    return () => { controller.abort(); markers.forEach((marker) => marker.setMap(null)); markersRef.current = [];
      path?.setMap(null); if (map) google.maps.event.clearInstanceListeners(map); mapRef.current = null; };
  }, [key]);

  useEffect(() => {
    const marker = markersRef.current[selectedIndex];
    if (marker && mapRef.current) mapRef.current.panTo(marker.getPosition()!);
    markersRef.current.forEach((entry, index) => entry.setOpacity(index === selectedIndex ? 1 : 0.75));
  }, [selectedIndex, key]);

  return <><div ref={element} className="smart-cart-map" role="img" aria-label="Interactive map of the selected shopping trip" />
    {error && <p role="status">{error}</p>}</>;
}
