import { z } from "zod";
import {
  krogerStores,
  krogerProducts,
  errorResponse,
  ProviderError,
} from "@/lib/live-data";
import { checkStores } from "@/lib/price-agent";
const input = z.object({
  zip: z.string().regex(/^\d{5}$/),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        name: z.string().min(2).max(60),
        unit: z.string().max(80),
        quantity: z.number().int().min(1).max(20),
      }),
    )
    .min(1)
    .max(10),
});
let running = false;
export async function POST(request: Request) {
  if (running)
    return Response.json(
      { error: "A price check is already running. Please try again shortly." },
      { status: 429 },
    );
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (
    !parsed.success ||
    new Set(parsed.data.items.map((i) => i.id)).size !==
      parsed.data.items.length
  )
    return Response.json(
      {
        error:
          "Choose 1–10 different items with valid quantities and a five-digit ZIP.",
      },
      { status: 400 },
    );
  running = true;
  try {
    if (!process.env.KROGER_CLIENT_ID || !process.env.KROGER_CLIENT_SECRET)
      throw new ProviderError(
        "Connect Kroger developer access to check real prices. Other retailers need their own price providers.",
        503,
      );
    const stores = await krogerStores(parsed.data.zip);
    return Response.json(
      {
        stores: await checkStores(parsed.data.items, stores, krogerProducts),
        foundStores: stores.length,
        checkedAt: new Date().toISOString(),
        coverage:
          "Up to two Kroger locations returned for this ZIP within ten miles. Other retailers are not checked. Search results require package review; stock is not verified.",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  } finally {
    running = false;
  }
}
