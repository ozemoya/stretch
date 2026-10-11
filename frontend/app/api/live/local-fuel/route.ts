import {
  centers,
  fuelTypes,
  errorResponse,
  type Area,
  type FuelType,
} from "@/lib/live-data";
import { parseOrigin } from "@/lib/locations";
import { configuredFuelPriceProvider } from "@/lib/fuel-price-provider";
export async function GET(request: Request) {
  const p = new URL(request.url).searchParams,
    area = p.get("area") ?? "downtown",
    radius = Number(p.get("radius") ?? 3),
    type = p.get("type") ?? "REGULAR_UNLEADED";
  if (
    !Object.hasOwn(centers, area) ||
    !Number.isFinite(radius) ||
    radius < 1 ||
    radius > 10 ||
    !(fuelTypes as readonly string[]).includes(type)
  )
    return Response.json(
      {
        error:
          "Choose an Atlanta area, radius of 1–10 miles and a supported fuel type.",
      },
      { status: 400 },
    );
  try {
    let origin;
    try {
      origin = parseOrigin(p);
    } catch {
      return Response.json(
        { error: "Enter valid latitude and longitude." },
        { status: 400 },
      );
    }
    const provider = configuredFuelPriceProvider();
    if (!provider) return Response.json({ error: "Gas price unavailable. No reported-price provider is configured." }, { status: 503 });
    return Response.json(
      await provider.search(area as Area, radius, type as FuelType, origin),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
