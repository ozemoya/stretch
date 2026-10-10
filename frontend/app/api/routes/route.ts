import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { points } = body;

    if (
      !Array.isArray(points) ||
      points.length < 2 ||
      points.length > 5 ||
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

    const coordinates = points.map((p) => `${p.lon},${p.lat}`).join(";");

    const base = process.env.OSRM_BASE_URL || "https://router.project-osrm.org";

    const url =
      `${base}/route/v1/driving/${coordinates}` +
      "?overview=full&geometries=geojson";

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error("Routing service unavailable");
    }

    const data = await response.json();

    if (data.code !== "Ok" || !data.routes?.length) {
      throw new Error("No driving route found");
    }

    const route = data.routes[0];

    return NextResponse.json({
      miles: Number((route.distance / 1609.344).toFixed(2)),
      minutes: Math.round(route.duration / 60),
      geometry: route.geometry,
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to calculate route" },
      { status: 502 },
    );
  }
}
