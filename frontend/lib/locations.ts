export const centers = {
  downtown: { lat: 33.749, lon: -84.388, zip: "30303" },
  midtown: { lat: 33.783, lon: -84.383, zip: "30309" },
  decatur: { lat: 33.7748, lon: -84.2963, zip: "30030" },
} as const;
export type SearchOrigin = {
  lat: number;
  lon: number;
  label: string;
  zip?: string;
};
export function validCoordinates(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lon === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180
  );
}
export function originQuery(origin?: SearchOrigin | null) {
  return origin
    ? `&lat=${origin.lat}&lon=${origin.lon}&label=${encodeURIComponent(origin.label)}`
    : "";
}
export function parseOrigin(params: URLSearchParams): SearchOrigin | undefined {
  if (!params.has("lat") && !params.has("lon")) return undefined;
  if (
    !params.has("lat") ||
    !params.has("lon") ||
    !params.get("lat")?.trim() ||
    !params.get("lon")?.trim()
  )
    throw new Error("Enter valid latitude and longitude.");
  const lat = Number(params.get("lat")),
    lon = Number(params.get("lon"));
  if (!validCoordinates(lat, lon))
    throw new Error("Enter valid latitude and longitude.");
  return {
    lat,
    lon,
    label: (params.get("label") || "your approximate location").slice(0, 100),
  };
}
