"use client";
import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap } from "leaflet";
import { centers, type SearchOrigin } from "@/lib/locations";
import type { Area, NearbyPlace } from "@/lib/live-data";
export default function OpenMap({
  area,
  radius,
  places,
  origin,
}: {
  area: Area;
  radius: number;
  places: NearbyPlace[];
  origin?: SearchOrigin | null;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LeafletMap | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    setError("");
    import("leaflet")
      .then((L) => {
        if (cancelled || !container.current) return;
        const c = origin ?? centers[area],
          instance = L.map(container.current, {
            scrollWheelZoom: false,
          }).setView([c.lat, c.lon], 13);
        map.current = instance;
        L.tileLayer(
          process.env.NEXT_PUBLIC_MAP_TILE_URL ||
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            maxZoom: 19,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
          },
        )
          .on("tileerror", () =>
            setError(
              "Some map tiles could not load. The station list and map links are still available.",
            ),
          )
          .addTo(instance);
        const circle = L.circle([c.lat, c.lon], {
          radius: radius * 1609.344,
          color: "#647426",
          fillOpacity: 0.08,
          weight: 2,
        }).addTo(instance);
        instance.fitBounds(circle.getBounds(), { padding: [12, 12] });
        const centerLabel = document.createElement("span");
        centerLabel.textContent = "Search area center";
        L.circleMarker([c.lat, c.lon], {
          radius: 7,
          color: "#382b22",
          fillColor: "#e7bb7b",
          fillOpacity: 1,
        })
          .bindPopup(centerLabel)
          .addTo(instance);
        for (const place of places) {
          const popup = document.createElement("div"),
            name = document.createElement("strong"),
            text = document.createElement("p"),
            link = document.createElement("a");
          name.textContent = place.name;
          text.textContent = `${place.address || "Address not supplied"} · ${place.miles} miles from area center`;
          link.href = place.mapUrl;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = "View on OpenStreetMap ↗";
          popup.append(name, text, link);
          L.circleMarker([place.lat, place.lon], {
            radius: 7,
            color: place.kind === "fuel" ? "#c7563e" : "#647426",
            fillColor: place.kind === "fuel" ? "#c7563e" : "#647426",
            fillOpacity: 0.85,
            weight: 2,
          })
            .bindPopup(popup)
            .addTo(instance);
        }
        observer = new ResizeObserver(() => instance.invalidateSize());
        observer.observe(container.current);
      })
      .catch((error) => {
        console.error("OpenStreetMap initialization failed", error);
        if (!cancelled)
          setError("The map could not load. Use the location links below.");
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
    };
  }, [area, radius, places, origin]);
  return (
    <>
      <div
        className="osm-map"
        ref={container}
        aria-label={`OpenStreetMap: locations within ${radius} ${radius === 1 ? "mile" : "miles"} of ${origin?.label ?? area}`}
      />
      <p className="map-caption">
        Green: groceries · Red: gas stations · Circle: your search radius
      </p>
      {error && <p role="status">{error}</p>}
    </>
  );
}
