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
  onSelectFuel,
  selectedFuelId,
  selectedPlaceId,
}: {
  area: Area;
  radius: number;
  places: NearbyPlace[];
  origin?: SearchOrigin | null;
  onSelectFuel?: (place: NearbyPlace) => void;
  selectedFuelId?: string | null;
  selectedPlaceId?: string | null;
}) {
  const container = useRef<HTMLDivElement>(null),
    map = useRef<LeafletMap | null>(null);
  const [error, setError] = useState("");
  const selectFuel = useRef(onSelectFuel);
  selectFuel.current = onSelectFuel;
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
            zoomAnimation: false,
            fadeAnimation: false,
            markerZoomAnimation: false,
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
          const highlighted = selectedPlaceId === place.id;
          const popup = document.createElement("div"),
            name = document.createElement("strong"),
            text = document.createElement("p"),
            link = document.createElement("a");
          name.textContent = place.name;
          text.textContent = `Address: ${place.address || "Not listed in map data"} · ${place.miles} miles from area center`;
          link.href = place.mapUrl;
          link.target = "_blank";
          link.rel = "noreferrer";
          link.textContent = "View on OpenStreetMap ↗";
          popup.append(name, text, link);
          if (place.kind === "fuel" && selectFuel.current) {
            const select = document.createElement("button");
            select.type = "button";
            select.textContent =
              selectedFuelId === place.id
                ? "Selected gas stop ✓"
                : "Add gas stop to trip";
            select.addEventListener("click", () => selectFuel.current?.(place));
            popup.append(select);
          }
          const marker = L.circleMarker([place.lat, place.lon], {
            radius: selectedFuelId === place.id || highlighted ? 10 : 7,
            color:
              selectedFuelId === place.id || highlighted
                ? "#382b22"
                : place.kind === "fuel"
                  ? "#c7563e"
                  : "#647426",
            fillColor: place.kind === "fuel" ? "#c7563e" : "#647426",
            fillOpacity: 0.85,
            weight: selectedFuelId === place.id || highlighted ? 4 : 2,
          })
            .bindPopup(popup)
            .addTo(instance);
          if (highlighted) {
            instance.panTo([place.lat, place.lon]);
            marker.openPopup();
          }
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
  }, [area, radius, places, origin, selectedFuelId, selectedPlaceId]);
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
