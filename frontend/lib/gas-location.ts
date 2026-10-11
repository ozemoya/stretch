import { z } from "zod";
import type { SearchOrigin } from "./locations";

const textSearchResponse = z.object({ places: z.array(z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
})).optional() });

export function validGasLocationQuery(input: string): string | null {
  const query = input.trim();
  if (!query || query.length > 120 || /^\d+$/.test(query) && !/^\d{5}$/.test(query)) return null;
  return query.length >= 5 ? query : null;
}

export function resolveGasLocation(raw: unknown, query: string): SearchOrigin | null {
  const place = textSearchResponse.parse(raw).places?.[0];
  if (!place || !Number.isFinite(place.location.latitude) || !Number.isFinite(place.location.longitude)) return null;
  return { lat: place.location.latitude, lon: place.location.longitude,
    label: place.formattedAddress || place.displayName?.text || query,
    zip: /^\d{5}$/.test(query) ? query : undefined };
}
