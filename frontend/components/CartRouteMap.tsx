"use client";

import { useEffect, useRef, useState } from "react";

type Point = { lat: number; lon: number; name?: string; label?: string };

export default function CartRouteMap({ points }: { points: Point[] }) {
  const element = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  const key = JSON.stringify(points.map(({ lat, lon }) => [lat, lon]));

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
        body: JSON.stringify({ points: [...points, points[0]].map(({ lat, lon }) => ({ lat, lon })) }),
        signal: controller.signal }).then(async (response) => {
          if (!response.ok) throw new Error("Route unavailable");
          return response.json() as Promise<{ geometry?: { coordinates?: [number, number][] } }>;
        }),
    ]).then(([{ Map }, route]) => {
      if (controller.signal.aborted || !element.current || !route.geometry?.coordinates?.length) return;
      map = new Map(element.current, { center: { lat: points[0].lat, lng: points[0].lon }, zoom: 11,
        scrollwheel: false, streetViewControl: false, mapTypeControl: false });
      const bounds = new google.maps.LatLngBounds();
      const routePoints = route.geometry.coordinates.map(([lon, lat]) => ({ lat, lng: lon }));
      routePoints.forEach((point) => bounds.extend(point));
      path = new google.maps.Polyline({ map, path: routePoints, strokeColor: "#61752a",
        strokeOpacity: 0.95, strokeWeight: 5 });
      points.forEach((point, index) => markers.push(new google.maps.Marker({ map,
        position: { lat: point.lat, lng: point.lon }, title: point.name ?? point.label ?? "Starting area",
        label: index === 0 ? "H" : String(index) })));
      map.fitBounds(bounds, 30);
    }).catch(() => { if (!controller.signal.aborted) setError("Route map unavailable. Use the directions link above."); });
    return () => { controller.abort(); markers.forEach((marker) => marker.setMap(null)); path?.setMap(null);
      if (map) google.maps.event.clearInstanceListeners(map); };
  }, [key]);

  return <><div ref={element} className="smart-cart-map" role="img" aria-label="Interactive map of the selected shopping trip" />
    {error && <p role="status">{error}</p>}</>;
}
