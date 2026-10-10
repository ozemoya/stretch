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
import { scrapeRetailers } from "@/lib/retailer-scraper";
import type { ScrapeReport } from "@/lib/retailer-scraper";
import { providerReports } from "@/lib/provider-prices";
import { mergeCatalogReports } from "@/lib/merge-catalog-reports";
import type { SearchPlan } from "@/lib/local-search-agent";
import { normalizeCatalogReport } from "@/lib/product-ownership";
import { freshMarketBranchOffers } from "@/lib/fresh-market-specials";
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
    const [publicCatalogs, providerCatalogs] = await Promise.all([
      options.deferPublic
        ? Promise.resolve([] as ScrapeReport[])
        : scrapeRetailers(
        coverage,
        p.items,
        mapped.places,
        agentPlan,
        request.signal,
        (report) => onReport?.(normalizeCatalogReport(report, p.items)),
      ),
      options.deferProvider
        ? Promise.resolve([] as ScrapeReport[])
        : providerReports(
            [...new Set(coverage.map((c) => c.retailer))],
            p.items,
            p.zip,
            true,
            false,
            onReport,
            agentPlan,
            false,
            request.signal,
          ),
    ]);
    for (const rawReport of providerCatalogs) {
      const report = normalizeCatalogReport(rawReport, p.items);
      const index = publicCatalogs.findIndex(
        (r) => r.retailer === report.retailer,
      );
      if (index >= 0) {
        publicCatalogs[index] =
          report.retailer === "The Fresh Market"
            ? mergeCatalogReports(publicCatalogs[index], report)
            : report;
      } else publicCatalogs.push(report);
    }
    for (const [index, report] of publicCatalogs.entries())
      publicCatalogs[index] = normalizeCatalogReport(report, p.items);
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
    if (coverage.some((row) => row.retailer === "The Fresh Market" && row.status !== "checked")) {
      try {
        const offers = await freshMarketBranchOffers(mapped.places, p.items, request.signal);
        for (const store of offers) {
          const row = coverage.find((entry) => entry.id === store.id);
          if (!row || row.status === "checked") continue;
          checkedStores.push(store);
          row.status = "checked";
          row.detail = "Store-number-matched weekly advertised offers. Stock and checkout price are unconfirmed; only listed specials are covered.";
        }
      } catch {
        request.signal.throwIfAborted();
        warnings.push("The Fresh Market weekly offer page could not be checked for nearby branches.");
      }
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
          return row
            ? [{ ...s, retailerId: "Kroger family", coverageId: row.id }]
            : [];
        });
        const checked = await checkStores(
          p.items.slice(0, 10),
          matched,
          krogerProducts,
          request.signal,
        );
        for (const store of checked) {
          const row = coverage.find(
            (c) => c.id === matched.find((m) => m.id === store.id)!.coverageId,
          )!;
          row.status = store.lines.every((l) => l.error) ? "failed" : "checked";
          row.detail =
            "Kroger API search (up to ten items, two matched branches, at most three 20-product pages per item). More catalog results may exist; remaining items and stock are unverified.";
          checkedStores.push({
            ...store,
            id: row.id,
            lines: [
              ...store.lines.map((line) => ({
                ...line,
                candidates: line.candidates
                  .filter(
                    (candidate) =>
                      candidate.storeLocationId === store.id &&
                      candidate.retailerId === row.retailer,
                  )
                  .map((candidate) => ({
                    ...candidate,
                    storeLocationId: row.id,
                  })),
              })),
              ...p.items.slice(10).map((item) => ({
                item,
                candidates: [],
                error:
                  "Not checked in this run due to provider request limits.",
              })),
            ],
          });
        }
      } catch {
        request.signal.throwIfAborted();
        warnings.push(
          "Kroger price search failed. Affected stores remain unpriced.",
        );
      }
    }
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
