import { z } from "zod";
import { getCatalog } from "@/lib/catalog";

const requestSchema = z.object({
  storeIds: z.array(z.string().min(1)).min(1).max(30),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Provide one to thirty store IDs." }, { status: 400 });
  }

  try {
    const { catalog } = await getCatalog();
    const requested = new Set(parsed.data.storeIds);
    const stores = catalog.stores
      .filter((store) =>
        requested.has(store.id) &&
        typeof store.latitude === "number" &&
        Number.isFinite(store.latitude) &&
        typeof store.longitude === "number" &&
        Number.isFinite(store.longitude),
      )
      .map((store) => ({
        id: store.id,
        name: store.name,
        address: store.address ?? "",
        lat: store.latitude as number,
        lon: store.longitude as number,
      }));
    return Response.json({ stores });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Store location lookup failed." },
      { status: 502 },
    );
  }
}
