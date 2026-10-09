import {
  centers,
  nearbyPlaces,
  errorResponse,
  type Area,
} from "@/lib/live-data";
export async function GET(request: Request) {
  const area = new URL(request.url).searchParams.get("area") ?? "downtown";
  if (!Object.hasOwn(centers, area))
    return Response.json(
      { error: "Choose an Atlanta starting area." },
      { status: 400 },
    );
  try {
    return Response.json(await nearbyPlaces(area as Area));
  } catch (e) {
    return errorResponse(e);
  }
}
