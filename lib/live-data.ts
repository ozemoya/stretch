import { load } from "cheerio";
import { z } from "zod";

export const centers = {
  downtown: { lat: 33.749, lon: -84.388, zip: "30303" },
  midtown: { lat: 33.783, lon: -84.383, zip: "30309" },
  decatur: { lat: 33.7748, lon: -84.2963, zip: "30030" },
} as const;
export type Area = keyof typeof centers;
export type FuelQuote = {
  kind?: "station" | "regional";
  stationName?: string;
  dollarsPerGallon: number;
  period: string;
  retrievedAt: string;
  sourceUrl: string;
  region: string;
};
export type NearbyPlace = {
  id: string;
  name: string;
  kind: "grocery" | "fuel";
  address: string;
  lat: number;
  lon: number;
  miles: number;
  mapUrl: string;
};
export const EIA_URL = "https://www.eia.gov/petroleum/gasdiesel/";
export class ProviderError extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

// Never log provider responses: they can contain credentials or access tokens.
const providerUsage = new Map<
  string,
  { day: number; total: number; minute: number; recent: number }
>();
async function checkedFetch(url: string, init: RequestInit = {}) {
  const host = new URL(url).hostname,
    day = Math.floor(Date.now() / 86400000),
    minute = Math.floor(Date.now() / 60000);
  const prior = providerUsage.get(host);
  const usage = {
    day,
    minute,
    total: prior?.day === day ? prior.total : 0,
    recent: prior?.minute === minute ? prior.recent : 0,
  };
  const cap =
    host === "overpass-api.de" ? 90 : host === "www.eia.gov" ? 12 : 800;
  if (usage.total >= cap || usage.recent >= 20)
    throw new ProviderError(
      "Live-data request limit reached. Please try again later.",
      429,
    );
  providerUsage.set(host, {
    ...usage,
    total: usage.total + 1,
    recent: usage.recent + 1,
  });
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok)
    throw new ProviderError(
      response.status === 429
        ? "The provider is busy. Please try again later."
        : "The provider could not return data. Please try again later.",
      response.status === 429 ? 429 : 502,
    );
  return response;
}

// Bound process-local caches and coalesce concurrent requests to protect provider quotas.
const cache = new Map<string, { until: number; value: unknown }>();
const pending = new Map<string, Promise<unknown>>();
async function cached<T>(
  key: string,
  ttl: number,
  get: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.value as T;
  const running = pending.get(key);
  if (running) return running as Promise<T>;
  const promise = get()
    .then((value) => {
      if (cache.size >= 100) cache.delete(cache.keys().next().value!);
      cache.set(key, { value, until: Date.now() + ttl });
      return value;
    })
    .finally(() => pending.delete(key));
  pending.set(key, promise);
  return promise;
}

export function parseEia(html: string, now = new Date()): FuelQuote {
  const $ = load(html);
  const table = $("table")
    .filter((_, t) =>
      $(t).find("caption").text().includes("U.S. Regular Gasoline Prices"),
    )
    .first();
  const row = table
    .find("tbody tr")
    .filter((_, r) => $(r).find("td").first().text().includes("Lower Atlantic"))
    .first();
  const headers = table.find("thead tr").last().find("th");
  const date = headers.eq(3).text().trim();
  const price = Number(row.find("td").eq(3).text().trim());
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(date);
  if (!match || !Number.isFinite(price) || price <= 0 || price > 20)
    throw new ProviderError(
      "The fuel publication changed format. Enter your gas price manually.",
    );
  const period = `20${match[3]}-${match[1]}-${match[2]}`;
  const age = now.getTime() - new Date(period + "T00:00:00Z").getTime();
  if (age < -86400000 || age > 21 * 86400000)
    throw new ProviderError(
      "The published fuel price is out of date. Enter your gas price manually.",
    );
  return {
    dollarsPerGallon: price,
    period,
    retrievedAt: now.toISOString(),
    sourceUrl: EIA_URL,
    region: "Lower Atlantic (PADD 1C)",
  };
}
export function fuelQuote() {
  return cached("fuel", 6 * 3600000, async () =>
    parseEia(await (await checkedFetch(EIA_URL)).text()),
  );
}
const osmSchema = z.object({
  osm3s: z.object({ timestamp_osm_base: z.string() }),
  elements: z.array(
    z.object({
      type: z.enum(["node", "way", "relation"]),
      id: z.number(),
      lat: z.number().optional(),
      lon: z.number().optional(),
      center: z.object({ lat: z.number(), lon: z.number() }).optional(),
      tags: z.record(z.string(), z.string()).optional(),
    }),
  ),
});
export function normalizePlaces(raw: unknown, area: Area) {
  const data = osmSchema.parse(raw),
    origin = centers[area];
  const places: NearbyPlace[] = [];
  for (const e of data.elements) {
    const t = e.tags ?? {},
      lat = e.lat ?? e.center?.lat,
      lon = e.lon ?? e.center?.lon;
    if (lat === undefined || lon === undefined) continue;
    const rad = Math.PI / 180;
    const a =
      Math.sin(((lat - origin.lat) * rad) / 2) ** 2 +
      Math.cos(lat * rad) *
        Math.cos(origin.lat * rad) *
        Math.sin(((lon - origin.lon) * rad) / 2) ** 2;
    places.push({
      id: `${e.type}/${e.id}`,
      name:
        t.name ??
        t.brand ??
        (t.amenity === "fuel" ? "Gas station" : "Grocery store"),
      kind: t.amenity === "fuel" ? "fuel" : "grocery",
      lat,
      lon,
      address: [t["addr:housenumber"], t["addr:street"], t["addr:city"]]
        .filter(Boolean)
        .join(" "),
      miles:
        Math.round(
          3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10,
        ) / 10,
      mapUrl: `https://www.openstreetmap.org/${e.type}/${e.id}`,
    });
  }
  return {
    places: places.sort((a, b) => a.miles - b.miles).slice(0, 60),
    updatedAt: data.osm3s.timestamp_osm_base,
    source: "OpenStreetMap contributors",
    radiusMiles: 5,
    area,
  };
}
export function nearbyPlaces(area: Area) {
  return cached(`places:${area}`, 3600000, async () => {
    const c = centers[area];
    const around = `(around:8047,${c.lat},${c.lon})`;
    const query = `[out:json][timeout:15];(nwr[shop=supermarket]${around};nwr[shop=grocery]${around};nwr[shop=convenience]${around};nwr[amenity=fuel]${around};);out center tags;`;
    const response = await checkedFetch(
      "https://overpass-api.de/api/interpreter",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent":
            "Stretch-Hacklanta/1.0 (https://github.com/ozemoya/stretch)",
        },
        body: new URLSearchParams({ data: query }).toString(),
      },
    );
    return normalizePlaces(await response.json(), area);
  });
}

let token: { value: string; until: number } | undefined;
let tokenRequest: Promise<string> | undefined;
export function krogerConfigured() {
  return !!(process.env.KROGER_CLIENT_ID && process.env.KROGER_CLIENT_SECRET);
}
async function krogerToken() {
  if (!krogerConfigured())
    throw new ProviderError(
      "Kroger prices need a developer app. Add its client ID and secret to the server environment.",
      503,
    );
  if (token && token.until > Date.now()) return token.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const response = await checkedFetch(
      "https://api.kroger.com/v1/connect/oauth2/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${process.env.KROGER_CLIENT_ID}:${process.env.KROGER_CLIENT_SECRET}`).toString("base64")}`,
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "product.compact",
        }).toString(),
      },
    );
    const data = z
      .object({
        access_token: z.string().min(1),
        expires_in: z.number().positive(),
      })
      .parse(await response.json());
    token = {
      value: data.access_token,
      until: Date.now() + Math.max(0, data.expires_in - 60) * 1000,
    };
    return token.value;
  })().finally(() => {
    tokenRequest = undefined;
  });
  return tokenRequest;
}
async function krogerGet(path: string) {
  const auth = await krogerToken();
  const response = await checkedFetch(`https://api.kroger.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${auth}` },
  });
  return response.json();
}
export function krogerStores(zip: string) {
  return cached(`kroger:stores:${zip}`, 3600000, async () => {
    const data = await krogerGet(
      `locations?${new URLSearchParams({ "filter.zipCode.near": zip, "filter.radiusInMiles": "10", "filter.limit": "10" })}`,
    );
    const parsed = z
      .object({
        data: z.array(
          z.object({
            locationId: z.string(),
            name: z.string(),
            address: z.object({
              addressLine1: z.string(),
              city: z.string(),
              state: z.string(),
              zipCode: z.string(),
            }),
          }),
        ),
      })
      .parse(data);
    return parsed.data.map((s) => ({
      id: s.locationId,
      name: s.name,
      address: `${s.address.addressLine1}, ${s.address.city}, ${s.address.state} ${s.address.zipCode}`,
    }));
  });
}
const productSchema = z.object({
  data: z.array(
    z.object({
      productId: z.string(),
      description: z.string(),
      brand: z.string().optional(),
      upc: z.string().optional(),
      items: z.array(
        z.object({
          itemId: z.string(),
          size: z.string().optional(),
          soldBy: z.string().optional(),
          price: z
            .object({ regular: z.number(), promo: z.number().optional() })
            .optional(),
        }),
      ),
    }),
  ),
});
export function normalizeKrogerProducts(
  raw: unknown,
  locationId: string,
  now = new Date(),
) {
  return productSchema.parse(raw).data.flatMap((p) =>
    p.items.map((i) => ({
      id: `${p.productId}:${i.itemId}`,
      productId: p.productId,
      locationId,
      name: p.description,
      brand: p.brand ?? "",
      upc: p.upc ?? "",
      size: i.size ?? "Not supplied",
      soldBy: i.soldBy ?? "Not supplied",
      regularCents:
        i.price && i.price.regular > 0
          ? Math.round(i.price.regular * 100)
          : null,
      promoCents:
        i.price?.promo && i.price.promo > 0
          ? Math.round(i.price.promo * 100)
          : null,
      retrievedAt: now.toISOString(),
    })),
  );
}
export function krogerProducts(locationId: string, term: string) {
  return cached(
    `kroger:products:${locationId}:${term.toLowerCase()}`,
    5 * 60000,
    async () =>
      normalizeKrogerProducts(
        await krogerGet(
          `products?${new URLSearchParams({ "filter.locationId": locationId, "filter.term": term, "filter.limit": "10" })}`,
        ),
        locationId,
      ),
  );
}
export function instacartRetailers(zip: string) {
  return cached(`instacart:${zip}`, 3600000, async () => {
    if (!process.env.INSTACART_API_KEY)
      throw new ProviderError(
        "Instacart retailer discovery needs an approved developer API key.",
        503,
      );
    const response = await checkedFetch(
      `https://connect.instacart.com/idp/v1/retailers?${new URLSearchParams({ postal_code: zip, country_code: "US" })}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.INSTACART_API_KEY}`,
          Accept: "application/json",
        },
      },
    );
    return z
      .object({
        retailers: z.array(
          z.object({ retailer_key: z.string(), name: z.string() }),
        ),
      })
      .parse(await response.json()).retailers;
  });
}

export function errorResponse(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof ProviderError
          ? error.message
          : "Live data is temporarily unavailable. Please try again later.",
    },
    { status: error instanceof ProviderError ? error.status : 502 },
  );
}

export type StationPrice = {
  id: string;
  name: string;
  address: string;
  miles: number;
  mapUrl: string;
  dollarsPerGallon: number | null;
  updatedAt: string | null;
  stale: boolean;
  attributions: { name: string; url: string }[];
};
export type LocalFuelResult = {
  stations: StationPrice[];
  radiusMiles: number;
  area: Area;
  fuelType: string;
  retrievedAt: string;
  source: "Google Maps";
};
export const fuelTypes = [
  "REGULAR_UNLEADED",
  "MIDGRADE",
  "PREMIUM",
  "DIESEL",
] as const;
export type FuelType = (typeof fuelTypes)[number];
const googlePlacesSchema = z.object({
  places: z
    .array(
      z.object({
        id: z.string(),
        displayName: z.object({ text: z.string() }),
        formattedAddress: z.string().optional(),
        googleMapsUri: z.string().url(),
        location: z.object({ latitude: z.number(), longitude: z.number() }),
        attributions: z
          .array(
            z.object({ provider: z.string(), providerUri: z.string().url() }),
          )
          .optional(),
        fuelOptions: z
          .object({
            fuelPrices: z
              .array(
                z.object({
                  type: z.string(),
                  updateTime: z.string().optional(),
                  price: z.object({
                    currencyCode: z.string(),
                    units: z.string().optional(),
                    nanos: z.number().optional(),
                  }),
                }),
              )
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});
function distanceMiles(lat: number, lon: number, area: Area) {
  const c = centers[area],
    r = Math.PI / 180;
  const a =
    Math.sin(((lat - c.lat) * r) / 2) ** 2 +
    Math.cos(lat * r) *
      Math.cos(c.lat * r) *
      Math.sin(((lon - c.lon) * r) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
export function normalizeLocalFuel(
  raw: unknown,
  area: Area,
  radiusMiles: number,
  fuelType: FuelType,
  now = new Date(),
): LocalFuelResult {
  const stations = googlePlacesSchema
    .parse(raw)
    .places.flatMap((p) => {
      const miles = distanceMiles(
        p.location.latitude,
        p.location.longitude,
        area,
      );
      if (miles > radiusMiles) return [];
      const f = p.fuelOptions?.fuelPrices?.find(
        (f) => f.type === fuelType && f.price.currencyCode === "USD",
      );
      const price = f
        ? Number(f.price.units ?? "0") + (f.price.nanos ?? 0) / 1e9
        : NaN;
      const updated =
        f?.updateTime && Number.isFinite(Date.parse(f.updateTime))
          ? f.updateTime
          : null;
      const age = updated ? now.getTime() - Date.parse(updated) : Infinity;
      return [
        {
          id: p.id,
          name: p.displayName.text,
          address: p.formattedAddress ?? "Address not supplied",
          mapUrl: p.googleMapsUri,
          miles: Math.round(miles * 10) / 10,
          dollarsPerGallon:
            Number.isFinite(price) && price > 0 && price < 20 ? price : null,
          updatedAt: updated,
          stale: age > 48 * 3600000 || age < -300000,
          attributions: (p.attributions ?? []).map((a) => ({
            name: a.provider,
            url: a.providerUri,
          })),
        },
      ];
    })
    .sort(
      (a, b) =>
        Number(a.stale || a.dollarsPerGallon === null) -
          Number(b.stale || b.dollarsPerGallon === null) ||
        (a.dollarsPerGallon ?? Infinity) - (b.dollarsPerGallon ?? Infinity) ||
        a.miles - b.miles,
    );
  return {
    stations,
    area,
    radiusMiles,
    fuelType,
    source: "Google Maps",
    retrievedAt: now.toISOString(),
  };
}
export function localFuelConfigured() {
  return (
    !!process.env.GOOGLE_MAPS_API_KEY &&
    process.env.GOOGLE_PLACES_ENABLED === "true"
  );
}
export async function localFuel(
  area: Area,
  radiusMiles: number,
  fuelType: FuelType,
) {
  if (!localFuelConfigured())
    throw new ProviderError(
      "Local pump prices need Google Places access. Configure a Places API key and enable the connection on the server.",
      503,
    );
  const c = centers[area];
  // Google Places content is not persisted or cached. Store-specific missing prices stay unknown.
  const r = await checkedFetch(
    "https://places.googleapis.com/v1/places:searchNearby",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY!,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri,places.fuelOptions,places.attributions",
      },
      body: JSON.stringify({
        includedTypes: ["gas_station"],
        maxResultCount: 20,
        rankPreference: "DISTANCE",
        locationRestriction: {
          circle: {
            center: { latitude: c.lat, longitude: c.lon },
            radius: radiusMiles * 1609.344,
          },
        },
      }),
    },
  );
  return normalizeLocalFuel(await r.json(), area, radiusMiles, fuelType);
}
