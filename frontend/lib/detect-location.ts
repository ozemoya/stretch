import { validCoordinates, type SearchOrigin } from "./locations";
export function normalizeIpLocation(data: unknown): SearchOrigin {
  const d = data as Record<string, unknown>;
  if (
    !d ||
    typeof d !== "object" ||
    d.success === false ||
    d.error ||
    !validCoordinates(d.latitude, d.longitude)
  )
    throw new Error("IP location unavailable.");
  const label = [d.city, d.region, d.country]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(", ")
    .slice(0, 100);
  return {
    // IP geolocation is approximate; avoid implying GPS precision or fragmenting city-level caches.
    lat: Math.round((d.latitude as number) * 1000) / 1000,
    lon: Math.round((d.longitude as number) * 1000) / 1000,
    label: label || "your approximate IP location",
    source: "ip",
    zip:
      typeof d.postal === "string" && /^\d{5}$/.test(d.postal)
        ? d.postal
        : undefined,
  };
}
export function detectDeviceLocation(signal?: AbortSignal): Promise<SearchOrigin> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      reject(error);
    };
    const abort = () => fail(new Error("Location lookup cancelled."));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener("abort", abort, { once: true });
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      fail(new Error("Device location is unavailable in this browser. Choose an area manually."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (settled) return;
        if (!validCoordinates(coords.latitude, coords.longitude) ||
          !Number.isFinite(coords.accuracy) || coords.accuracy < 0) {
          fail(new Error("Your device did not return a usable location. Try again or choose an area manually."));
          return;
        }
        settled = true;
        signal?.removeEventListener("abort", abort);
        resolve({
          lat: coords.latitude,
          lon: coords.longitude,
          label: "Your device location",
          source: "device",
          accuracyMeters: Math.round(coords.accuracy),
        });
      },
      (error) => fail(new Error(error.code === 1
        ? "Location permission was denied. You can still choose an area manually."
        : "Could not get your device location. Try again or choose an area manually.")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
    );
  });
}
/** Automatic location uses the device's current position, with no IP fallback. */
export function detectLocation(
  signal: AbortSignal,
): Promise<SearchOrigin> {
  return detectDeviceLocation(signal);
}
