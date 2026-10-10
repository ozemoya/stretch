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
const input = z.object({
  zip: z.string().regex(/^\d{5}$/),
  start: z.boolean().default(false),
  broaden: z.boolean().default(false),
  stream: z.boolean().default(false),
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
  savePricesAfterResponse(() => [...reportsToSave.values()].map(report => catalogPriceBatch(report, p.zip)));
  // Hosted-job polling belongs only to the default adapter. Store libraries own their own requests.
  const retailers = p.retailers.filter(retailer => scraperRegistry.get(retailer).id === "default");
  if (p.stream) {
    const reports = new Map<string, ScrapeReport>();
    return deadlineStream(request.signal, async (send, signal) => {
      const emit = (raw: ScrapeReport) => {
        if (signal.aborted) return;
        const report = normalizeCatalogReport(raw, p.items);
        reports.set(report.retailer, report);
        reportsToSave.set(report.retailer, report);
        send({ type: "report", report });
      };
      const completed = await providerReports(retailers, p.items, p.zip, p.start, false,
        emit, undefined, p.broaden, signal, { fast: true });
      for (const report of completed) emit(report);
    }, (reason, elapsedMs) => [{ type: "complete", elapsedMs, timedOut: reason === "timeout",
      reports: settlePendingReports([...reports.values()], "timeout") }]);
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
