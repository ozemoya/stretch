import {
  centers,
  googleNearbyPlaces,
  errorResponse,
  type Area,
} from "@/lib/live-data";
import { parseOrigin } from "@/lib/locations";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const area = params.get("area") ?? "downtown",
    radius = Number(params.get("radius") ?? 5),
    kind = params.get("kind") ?? "all";
  if (
    !Object.hasOwn(centers, area) ||
    !Number.isFinite(radius) ||
    radius < 1 ||
    radius > 10 ||
    !["all", "grocery", "fuel"].includes(kind)
  )
    return Response.json(
      {
        error:
          "Choose an Atlanta area, radius from 1–10 miles, and grocery or fuel locations.",
      },
      { status: 400 },
    );
  try {
    let origin;
    try {
      origin = parseOrigin(params);
    } catch {
      return Response.json(
        { error: "Enter valid latitude and longitude." },
        { status: 400 },
      );
    }
    return Response.json(
      await googleNearbyPlaces(
        area as Area,
        radius,
        kind as "all" | "grocery" | "fuel",
        origin,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
