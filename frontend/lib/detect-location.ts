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
export function detectDeviceLocation(): Promise<SearchOrigin> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Device location is unavailable in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (!validCoordinates(coords.latitude, coords.longitude) ||
          !Number.isFinite(coords.accuracy) || coords.accuracy < 0) {
          reject(new Error("Your device did not return a usable location."));
          return;
        }
        resolve({
          lat: coords.latitude,
          lon: coords.longitude,
          label: "Your device location",
          source: "device",
          accuracyMeters: Math.round(coords.accuracy),
        });
      },
      (error) => reject(new Error(error.code === 1
        ? "Location permission was denied. You can still choose an area manually."
        : "Could not get your device location. Try again or choose an area manually.")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 },
    );
  });
}
async function json(url: string, signal: AbortSignal, init: RequestInit = {}) {
  const r = await fetch(url, {
    ...init,
    signal,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    cache: "no-store",
  });
  if (!r.ok) throw new Error("IP lookup unavailable.");
  return r.json();
}
export async function detectLocation(
  signal: AbortSignal,
): Promise<SearchOrigin> {
  try {
    return normalizeIpLocation(
      await json(
        "https://ipwho.is/",
        AbortSignal.any([signal, AbortSignal.timeout(7000)]),
      ),
    );
  } catch {
    if (signal.aborted) throw new Error("Location lookup cancelled.");
  }
  // Resolve the visitor's public IP in their browser. Never geolocate the Next.js server's IP.
  const { ip } = await json(
    "https://api.ipify.org?format=json",
    AbortSignal.any([signal, AbortSignal.timeout(7000)]),
  );
  return json(
    "/api/location",
    AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip }),
    },
  );
}
