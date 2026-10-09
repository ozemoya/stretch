import {
  centers,
  nearbyPlaces,
  errorResponse,
  type Area,
} from "@/lib/live-data";
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
    return Response.json(
      await nearbyPlaces(
        area as Area,
        radius,
        kind as "all" | "grocery" | "fuel",
      ),
    );
  } catch (e) {
    return errorResponse(e);
  }
}
