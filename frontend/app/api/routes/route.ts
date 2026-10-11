import { NextRequest, NextResponse } from "next/server";
import { googleRoute, googleRouteMatrix } from "@/lib/google-routes";
import { roadDirections } from "@/lib/road-directions";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { points, matrix } = body;

    if (
      !Array.isArray(points) ||
      points.length < 2 ||
      points.length > (matrix === true ? 10 : 6) ||
      !points.every(
        (p) =>
          typeof p.lat === "number" &&
          typeof p.lon === "number" &&
          Number.isFinite(p.lat) &&
          Number.isFinite(p.lon) &&
          p.lat >= -90 &&
          p.lat <= 90 &&
          p.lon >= -180 &&
          p.lon <= 180,
      )
    ) {
      return NextResponse.json(
        { error: "Invalid route coordinates" },
        { status: 400 },
      );
    }

    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
    const googleKey = process.env.GOOGLE_MAPS_API_KEY;
    if (googleKey) {
      try {
        const result = matrix === true
          ? await googleRouteMatrix(points, googleKey, signal)
          : await googleRoute(points, googleKey, signal);
        return NextResponse.json(result);
      } catch (error) {
        // The existing road router keeps the trip usable when Routes API is not enabled.
        console.warn("Google Routes unavailable; trying road-router fallback:",
          error instanceof Error ? error.message : "unknown error");
      }
    }

    const coordinates = points.map((p) => `${p.lon},${p.lat}`).join(";");

    const base = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";

    const url = matrix === true
      ? `${base}/table/v1/driving/${coordinates}?annotations=distance,duration`
      : `${base}/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true`;

    const response = await fetch(url, {
      signal,
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Routing service unavailable");
    }

    const data = await response.json();

    if (matrix === true) {
      if (data.code !== "Ok" || !Array.isArray(data.distances) || !Array.isArray(data.durations) ||
        data.distances.length !== points.length || data.durations.length !== points.length ||
        !data.distances.every((row: unknown) => Array.isArray(row) && row.length === points.length &&
          row.every((value: unknown) => value === null || typeof value === "number" && Number.isFinite(value) && value >= 0)) ||
        !data.durations.every((row: unknown) => Array.isArray(row) && row.length === points.length &&
          row.every((value: unknown) => value === null || typeof value === "number" && Number.isFinite(value) && value >= 0)))
        throw new Error("No road-distance matrix found");
      return NextResponse.json({ distances: data.distances, durations: data.durations, provider: "osrm" });
    }
    if (data.code !== "Ok" || !data.routes?.length) {
      throw new Error("No driving route found");
    }

    const route = data.routes[0];

    return NextResponse.json({
      miles: Number((route.distance / 1609.344).toFixed(2)),
      minutes: route.duration / 60,
      geometry: route.geometry,
      steps: roadDirections(route.legs ?? []),
      legs: Array.isArray(route.legs) ? route.legs.map((leg: { distance: number; duration: number }) => ({
        miles: leg.distance / 1609.344, minutes: leg.duration / 60,
      })) : [],
      provider: "osrm",
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to calculate route" },
      { status: 502 },
    );
  }
}
