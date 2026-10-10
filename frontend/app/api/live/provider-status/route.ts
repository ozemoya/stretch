import { z } from "zod";
import { providerReports } from "../../../../lib/provider-prices";
import { normalizeCatalogReport } from "../../../../lib/product-ownership";
import { deadlineStream, untilAborted } from "../../../../lib/deadline-stream";
import { SEARCH_WINDOW_MS } from "../../../../lib/search-timing";
import { settlePendingReports } from "../../../../lib/search-state";
import type { ScrapeReport } from "../../../../lib/retailer-scraper";
import { catalogPriceBatch } from "../../../../lib/scrapers/persistence";
import { savePricesAfterResponse } from "../../../../lib/scrapers/save-after-response";
import { scraperRegistry } from "../../../../lib/scrapers";
import { nearbyPlaces } from "../../../../lib/live-data";
import { groceryCoverage } from "../../../../lib/retailer-coverage";
import { scrapeBranches, scrapeRetailers } from "../../../../lib/retailer-scraper";
import { branchPriceBatch } from "../../../../lib/scrapers/persistence";
const input = z.object({
  zip: z.string().regex(/^\d{5}$/),
  start: z.boolean().default(false),
  broaden: z.boolean().default(false),
  stream: z.boolean().default(false),
  poll: z.boolean().default(false),
  missingRetailers: z.array(z.string().max(80)).max(20).default([]),
  location: z.object({
    area: z.enum(["downtown", "midtown", "decatur"]),
    radius: z.number().min(1).max(10),
    origin: z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180),
      label: z.string().min(1).max(100) }).optional(),
  }).optional(),
  retailers: z.array(z.string().max(80)).max(20),
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
export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "Invalid price status request." },
      { status: 400 },
    );
  const p = parsed.data;
  const reportsToSave = new Map<string, ScrapeReport>();
  const branchesToSave: ReturnType<typeof branchPriceBatch>[] = [];
  savePricesAfterResponse(() => [...reportsToSave.values()].map(report => catalogPriceBatch(report, p.zip)).concat(branchesToSave));
  // Hosted-job polling belongs only to the default adapter. Store libraries own their own requests.
  const retailers = p.retailers.filter(retailer => scraperRegistry.get(retailer).id === "default");
  if (p.stream) {
    const reports = new Map<string, ScrapeReport>();
    let branchesFinished = !p.location;
    return deadlineStream(request.signal, async (send, signal) => {
      const emit = (raw: ScrapeReport) => {
        if (signal.aborted) return;
        const report = normalizeCatalogReport(raw, p.items);
        reports.set(report.retailer, report);
        reportsToSave.set(report.retailer, report);
        send({ type: "report", report });
      };
      const providerTask = providerReports(retailers.filter(retailer => !p.missingRetailers.includes(retailer)), p.items, p.zip, p.start, false,
        emit, undefined, p.broaden, signal, { fast: true });
      const locationTask = p.location ? (async () => {
        const mapped = await nearbyPlaces(p.location!.area, p.location!.radius, "grocery", p.location!.origin);
        signal.throwIfAborted();
        const coverage = groceryCoverage(mapped.places);
        send({ type: "coverage", storeCoverage: coverage });
        // Only initialize sources missed by the first search. Existing hosted jobs are polled above.
        const missing = coverage.filter(store => p.missingRetailers.includes(store.retailer));
        const libraries = Promise.all([...new Set(missing.map(store => store.retailer))].map(retailer =>
          scrapeRetailers(missing.filter(store => store.retailer === retailer), p.items, mapped.places,
            undefined, signal, emit, { zip: p.zip, fast: true })));
        const branchTask = scrapeBranches({ stores: coverage, items: p.items, places: mapped.places,
          zip: p.zip, signal }).then(checked => {
          signal.throwIfAborted();
          branchesFinished = true;
          branchesToSave.push(...checked.stores.map(store => branchPriceBatch(store, coverage)));
          send({ type: "branches", stores: checked.stores, warnings: checked.warnings });
        });
        await Promise.all([libraries, branchTask]);
      })() : Promise.resolve();
      const [completed] = await Promise.all([providerTask, locationTask]);
      for (const report of completed) emit(report);
    }, (reason, elapsedMs) => [{ type: "complete", elapsedMs, timedOut: reason === "timeout",
      branchesFinished, reports: p.poll ? [...reports.values()] : settlePendingReports([...reports.values()], "timeout") }]);
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(SEARCH_WINDOW_MS)]);
  const reports = await untilAborted(providerReports(retailers, p.items, p.zip,
    p.start, false, undefined, undefined, p.broaden, signal, { fast: true }), signal).catch(() => undefined);
  for (const report of reports ?? []) reportsToSave.set(report.retailer, normalizeCatalogReport(report, p.items));
  return Response.json(
    {
      reports: settlePendingReports((reports ?? []).map((report) => normalizeCatalogReport(report, p.items)), "timeout"),
      timedOut: signal.aborted,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
