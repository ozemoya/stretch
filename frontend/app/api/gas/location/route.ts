import { resolveGasLocation, validGasLocationQuery } from "@/lib/gas-location";
import { checkedFetch, ProviderError } from "@/lib/live-data";

export async function GET(request: Request) {
  const query = validGasLocationQuery(new URL(request.url).searchParams.get("q") ?? "");
  if (!query) return Response.json({ error: "Enter a five-digit ZIP code or a full address." }, { status: 400 });
  if (!process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_ENABLED !== "true")
    return Response.json({ error: "Location search is not configured." }, { status: 503 });
  try {
    const response = await checkedFetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location" },
      body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    });
    const origin = resolveGasLocation(await response.json(), query);
    if (!origin) return Response.json({ error: "No matching location found. Check the ZIP or address." }, { status: 404 });
    return Response.json({ origin }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProviderError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Location search timed out or could not connect. Try again." }, { status: 504 });
  }
}
