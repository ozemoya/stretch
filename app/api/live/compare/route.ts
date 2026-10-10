import { z } from "zod";
import {
  krogerStores,
  krogerProducts,
  errorResponse,
  nearbyPlaces,
  krogerConfigured,
} from "@/lib/live-data";
import { checkStores } from "@/lib/price-agent";
import { groceryCoverage } from "@/lib/retailer-coverage";
import { groceryFeed } from "@/lib/grocery-feed";
const input = z.object({
  zip: z.string().regex(/^\d{5}$/),
  area: z.enum(["downtown", "midtown", "decatur"]).default("downtown"),
  origin: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
      label: z.string().min(1).max(100),
      zip: z
        .string()
        .regex(/^\d{5}$/)
        .optional(),
    })
    .optional(),
  radius: z.number().min(1).max(10).default(5),
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
    .max(30),
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
          "Choose 1–30 different items, a five-digit ZIP, valid coordinates, and a radius of 1–10 miles.",
      },
      { status: 400 },
    );
  running = true;
  try {
    const p = parsed.data;
    const mapped = await nearbyPlaces(p.area, p.radius, "grocery", p.origin);
    const coverage = groceryCoverage(mapped.places);
    const checkedStores = [] as Awaited<ReturnType<typeof checkStores>>;
    const warnings: string[] = [];
    try {
      const feed = await groceryFeed(coverage, p.items);
      if (feed) {
        checkedStores.push(...feed.stores);
        for (const store of feed.stores) {
          const row = coverage.find((c) => c.id === store.id)!;
          row.status = "checked";
          row.detail = `Price source: ${feed.source}. Review each package; missing or stale prices remain unknown.`;
        }
      }
    } catch {
      warnings.push(
        "The multi-retailer price feed failed. Its prices remain unavailable.",
      );
    }
    if (
      krogerConfigured() &&
      coverage.some(
        (c) => c.retailer === "Kroger family" && c.status !== "checked",
      )
    ) {
      try {
        const stores = await krogerStores(p.zip);
        // Match the exact physical branch; never attach a different store's prices by brand alone.
        const matched = stores.flatMap((s) => {
          if (!s.coordinates) return [];
          const row = coverage.find(
            (c) =>
              c.status !== "checked" &&
              c.retailer === "Kroger family" &&
              Math.abs(
                mapped.places.find((m) => m.id === c.id)!.lat -
                  s.coordinates!.lat,
              ) < 0.001 &&
              Math.abs(
                mapped.places.find((m) => m.id === c.id)!.lon -
                  s.coordinates!.lon,
              ) < 0.001,
          );
          return row ? [{ ...s, coverageId: row.id }] : [];
        });
        const checked = await checkStores(
          p.items.slice(0, 10),
          matched,
          krogerProducts,
        );
        for (const store of checked) {
          const row = coverage.find(
            (c) => c.id === matched.find((m) => m.id === store.id)!.coverageId,
          )!;
          row.status = store.lines.every((l) => l.error) ? "failed" : "checked";
          row.detail =
            "Kroger API search (up to ten items, two matched branches). Remaining items are unpriced; stock is not verified.";
          checkedStores.push({
            ...store,
            id: row.id,
            lines: [
              ...store.lines,
              ...p.items
                .slice(10)
                .map((item) => ({
                  item,
                  candidates: [],
                  error:
                    "Not checked in this run due to provider request limits.",
                })),
            ],
          });
        }
      } catch {
        warnings.push(
          "Kroger price search failed. Affected stores remain unpriced.",
        );
      }
    }
    return Response.json(
      {
        stores: checkedStores,
        storeCoverage: coverage,
        warnings,
        foundStores: coverage.length,
        checkedAt: new Date().toISOString(),
        coverage: `Discovered ${coverage.length} mapped grocery locations within ${p.radius} miles of ${mapped.origin.label}, across all retailers in the map response. Price sources were queried only where connected. Map coverage can be incomplete.`,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  } finally {
    running = false;
  }
}
