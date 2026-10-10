import { z } from "zod";
import {
  errorResponse,
  nearbyPlaces,
} from "@/lib/live-data";
import { checkStores } from "@/lib/price-agent";
import { groceryCoverage } from "@/lib/retailer-coverage";
import { groceryFeed } from "@/lib/grocery-feed";
import { scrapeRetailers, scrapeBranches } from "@/lib/retailer-scraper";
import type { ScrapeReport } from "@/lib/retailer-scraper";
import { catalogPriceBatch, branchPriceBatch } from "@/lib/scrapers/persistence";
import { savePricesAfterResponse } from "@/lib/scrapers/save-after-response";
import type { SearchPlan } from "@/lib/local-search-agent";
import { normalizeCatalogReport } from "@/lib/product-ownership";
export const input = z.object({
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
export async function compareBasket(
  request: Request,
  onReport?: (report: ScrapeReport) => void,
  agentPlan?: SearchPlan,
  options: { deferProvider?: boolean; deferPublic?: boolean; deferPlan?: boolean } = {},
) {
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
  try {
    request.signal.throwIfAborted();
    const p = parsed.data;
    const mapped = await nearbyPlaces(p.area, p.radius, "grocery", p.origin);
    request.signal.throwIfAborted();
    const coverage = groceryCoverage(mapped.places);
    const publicCatalogs = options.deferPublic ? [] : await scrapeRetailers(
      coverage, p.items, mapped.places, agentPlan, request.signal,
      report => onReport?.(normalizeCatalogReport(report, p.items)), { zip: p.zip },
    );
    request.signal.throwIfAborted();
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
    const branchResult = await scrapeBranches({ stores: coverage, items: p.items, places: mapped.places,
      zip: p.zip, plan: agentPlan, signal: request.signal });
    warnings.push(...branchResult.warnings);
    for (const store of branchResult.stores) {
      const row = coverage.find(entry => entry.id === store.id)!;
      row.status = store.lines.every(line => line.error) ? "failed" : "checked";
      row.detail = "Store-specific library checked this physical branch. Review each package and source.";
      checkedStores.push(store);
    }
    savePricesAfterResponse(() => [
      ...publicCatalogs.map(report => catalogPriceBatch(report, p.zip)),
      ...checkedStores.map(store => branchPriceBatch(store, coverage)),
    ]);
    return Response.json(
      {
        stores: checkedStores,
        agent: {
          aiConnected: !!agentPlan,
          mode: agentPlan
            ? `${agentPlan.provider === "openai" ? "OpenAI" : "Local AI"} planned product searches using ${agentPlan.model}; prices still come from validated retailer pages.`
            : options.deferPlan
              ? "AI is planning product searches while connected prices load."
            : process.env.BRIGHT_DATA_SERP_ZONE
              ? "Website search is running; AI planning was unavailable or timed out."
              : "AI planning and the website search provider are unavailable.",
        },
        providerSearchDeferred: options.deferProvider,
        publicSearchDeferred: options.deferPublic,
        publicCatalogs,
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
  }
}
