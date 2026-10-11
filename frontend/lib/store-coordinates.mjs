// Shared by Next.js scrapers and the Node.js Kroger CLI. Census geocodes US
// street addresses; its points are calculated along address ranges.
export function validStoreCoordinates(latitude, longitude) {
  const valid = (value, limit) => (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
    Number.isFinite(Number(value)) && Math.abs(Number(value)) <= limit;
  return valid(latitude, 90) && valid(longitude, 180);
}

export function storeAddress(address) {
  if (typeof address === "string") return address.trim().replace(/\s+/g, " ");
  if (!address || typeof address !== "object") return "";
  const clean = value => typeof value === "string" ? value.trim() : "";
  return [clean(address.addressLine1), clean(address.addressLine2), clean(address.city),
    [clean(address.state), clean(address.zipCode)].filter(Boolean).join(" ")]
    .filter(Boolean).join(", ");
}

const caches = new WeakMap();
let active = 0;
const queue = [];
async function requestSlot(task, signal) {
  if (active >= 2) await new Promise(resolve => queue.push(resolve));
  else active++;
  try { signal?.throwIfAborted(); return await task(); }
  finally { const next = queue.shift(); if (next) next(); else active--; }
}

/** Preserve a valid explicit pair; otherwise require one unambiguous address match. */
export async function resolveStoreCoordinates(location, { fetcher = fetch, signal } = {}) {
  signal?.throwIfAborted();
  if (validStoreCoordinates(location.latitude, location.longitude))
    return { latitude: Number(location.latitude), longitude: Number(location.longitude), source: "explicit" };
  const address = storeAddress(location.address);
  // City/ZIP centroids and placeholder addresses cannot establish a physical branch.
  if (address.length > 400 || !/^\d+[a-z]?(?:[-/]\d+)?\s+\S/i.test(address) ||
    !(/\b\d{5}(?:-\d{4})?\s*$/.test(address) || /,\s*[a-z .'-]+,?\s+[a-z]{2}\b/i.test(address))) return null;
  let cache = caches.get(fetcher);
  if (!cache) { cache = new Map(); caches.set(fetcher, cache); }
  const key = address.toLowerCase(), now = Date.now(), hit = cache.get(key);
  if (!signal && hit && hit.until > now) return hit.promise;
  const task = requestSlot(async () => {
    try {
      const params = new URLSearchParams({ address, benchmark: "Public_AR_Current", format: "json" });
      const response = await fetcher(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?${params}`, {
        headers: { Accept: "application/json" }, redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const text = await response.text();
      if (text.length > 1000000) return null;
      const matches = JSON.parse(text)?.result?.addressMatches;
      if (!Array.isArray(matches) || matches.length !== 1) return null;
      const match = matches[0], point = match?.coordinates;
      if (!validStoreCoordinates(point?.y, point?.x)) return null;
      const zip = address.match(/\b(\d{5})(?:-\d{4})?\s*$/)?.[1];
      if (zip && match.addressComponents?.zip !== zip) return null;
      return { latitude: Number(point.y), longitude: Number(point.x), source: "census-address" };
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  }, signal);
  // Canceled searches do not poison shared cache entries or other callers.
  if (!signal) {
    if (cache.size >= 500) cache.delete(cache.keys().next().value);
    const entry = { until: now + 86400000, promise: task };
    cache.set(key, entry);
    task.then(point => { if (!point) entry.until = Date.now() + 300000; });
  }
  return task;
}
