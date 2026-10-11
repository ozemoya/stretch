import { z } from "zod";
import { googlePlaceByName } from "@/lib/live-data";

const requestSchema = z.object({
  stores: z.array(z.object({
    id: z.string().min(1).max(200),
    name: z.string().trim().min(1).max(200),
  })).min(1).max(8),
  origin: z.object({ lat: z.number().finite(), lon: z.number().finite() }),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const places = (await Promise.all(body.stores.map(async (store) => {
      const place = await googlePlaceByName(store.name, { ...body.origin, label: "trip origin" });
      return place ? { requestedId: store.id, requestedName: store.name, ...place } : null;
    }))).filter((place): place is NonNullable<typeof place> => !!place);
    return Response.json({
      places,
      unmatched: body.stores
        .filter((store) => !places.some((place) => place.requestedId === store.id))
        .map((store) => ({ id: store.id, name: store.name })),
    });
  } catch (error) {
    const status = error instanceof z.ZodError ? 400 : 502;
    return Response.json({ error: error instanceof Error ? error.message : "Store lookup failed." }, { status });
  }
}
