import { z } from "zod";
import { checkedFetch, ProviderError } from "@/lib/live-data";

const detailsSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }).optional(),
  formattedAddress: z.string().optional(),
  businessStatus: z.string().optional(),
  rating: z.number().optional(),
  currentOpeningHours: z.object({ openNow: z.boolean().optional() }).optional(),
  websiteUri: z.url().optional(),
  nationalPhoneNumber: z.string().optional(),
  googleMapsUri: z.url().optional(),
  attributions: z.array(z.object({ provider: z.string(), providerUri: z.url().optional() })).optional(),
});

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_:-]{8,200}$/.test(id))
    return Response.json({ error: "Choose a valid station." }, { status: 400 });
  if (!process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_ENABLED !== "true")
    return Response.json({ error: "Station details are not configured." }, { status: 503 });
  try {
    const response = await checkedFetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
      headers: { "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "id,displayName,formattedAddress,businessStatus,rating,currentOpeningHours.openNow,websiteUri,nationalPhoneNumber,googleMapsUri,attributions" },
      signal: AbortSignal.timeout(9000), cache: "no-store",
    });
    const details = detailsSchema.parse(await response.json());
    if (details.id !== id) return Response.json({ error: "Station details did not match the selected location." }, { status: 502 });
    return Response.json({ details }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ProviderError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Station details timed out or could not connect." }, { status: 504 });
  }
}
