import { krogerStores, krogerProducts, errorResponse } from "@/lib/live-data";
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams;
  const zip = p.get("zip"),
    locationId = p.get("locationId"),
    term = p.get("term")?.trim();
  if (zip && /^\d{5}$/.test(zip) && !locationId) {
    try {
      return Response.json({ stores: await krogerStores(zip) });
    } catch (e) {
      return errorResponse(e);
    }
  }
  if (
    locationId &&
    /^\d{6,12}$/.test(locationId) &&
    term &&
    term.length >= 2 &&
    term.length <= 60
  ) {
    try {
      return Response.json({
        products: await krogerProducts(locationId, term),
      });
    } catch (e) {
      return errorResponse(e);
    }
  }
  return Response.json(
    {
      error:
        "Enter a five-digit ZIP, or a Kroger location ID and a search of 2–60 characters.",
    },
    { status: 400 },
  );
}
