import {
  input,
  compareBasket as compare,
} from "../../../../lib/compare-basket";
import { providerReports } from "../../../../lib/provider-prices";
import { traderJoesObserved } from "../../../../lib/trader-joes";
import { planBasketSearch } from "../../../../lib/local-search-agent";
import { normalizeCatalogReport } from "../../../../lib/product-ownership";
import { scrapeRetailers } from "../../../../lib/retailer-scraper";
import { nearbyPlaces } from "../../../../lib/live-data";
import type { StoreCoverage } from "../../../../lib/retailer-coverage";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = input.safeParse(body);
  if (
    !parsed.success ||
    new Set(parsed.data.items.map((i) => i.id)).size !==
      parsed.data.items.length
  )
    return Response.json(
      { error: "Choose 1–30 distinct foods and a valid search location." },
      { status: 400 },
    );
  const p = parsed.data;
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(controller) {
        let open = true;
        request.signal.addEventListener(
          "abort",
          () => {
            open = false;
          },
          { once: true },
        );
        const send = (value: unknown) => {
          if (open)
            controller.enqueue(encoder.encode(JSON.stringify(value) + "\n"));
        };
        try {
          send({ type: "started" });
          // No collector is triggered by this cache read. Cached observations retain their timestamps.
          const tjLines = p.items.map((item) => ({
            item,
            products: traderJoesObserved(item),
          }));
          const tjReport = tjLines.some((line) => line.products.length)
            ? normalizeCatalogReport(
                {
                  retailer: "Trader Joe’s",
                  status: "retrieved",
                  detail:
                    "Dated official website observations. Nearby branch presence is being checked.",
                  lines: tjLines,
                },
                p.items,
              )
            : null;
          if (tjReport) send({ type: "report", cached: true, report: tjReport });
          const cached = await providerReports(
            [
              "Walmart",
              "Target",
              "Publix",
              "ALDI",
              "The Fresh Market",
              "Food Lion",
              "Sam’s Club",
              "Sprouts",
              "Costco",
              "Albertsons family",
            ],
            p.items,
            p.zip,
            false,
            true,
          );
          for (const report of cached)
            if (report.lines.some((line) => line.products.length))
              send({
                type: "report",
                report: normalizeCatalogReport(report, p.items),
                cached: true,
              });
          send({ type: "agent", stage: "planning" });
          // AI expands queries, but cannot hold the retailer search for its full timeout.
          const planningSignal = AbortSignal.any([
            request.signal,
            AbortSignal.timeout(process.env.OPENAI_API_KEY ? 4500 : 2500),
          ]);
          const planningTask = planBasketSearch(p.items, planningSignal).catch(() => null);
          const response = await compare(
            new Request(request.url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(p),
              signal: request.signal,
            }),
            (report) =>
              send({
                type: "report",
                report: normalizeCatalogReport(report, p.items),
              }),
            undefined,
            { deferProvider: true, deferPublic: true, deferPlan: true },
          );
          const result = await response.json();
          if (!response.ok) {
            send({ type: "error", error: result.error });
            return;
          }
          // The comparison is usable now; slow retailer collection continues on this stream.
          send({ type: "complete", result });
          if (tjReport) send({ type: "report", cached: true, report: tjReport });
          for (const report of cached)
            if (report.lines.some((line) => line.products.length))
              send({ type: "report", report: normalizeCatalogReport(report, p.items), cached: true });
          const coverage = result.storeCoverage as StoreCoverage[];
          const planNotification = planningTask.then((agentPlan) => send({
            type: "agent",
            stage: agentPlan ? "ready" : "unavailable",
            provider: agentPlan?.provider,
            model: agentPlan?.model,
          }));
          // Independent source tasks stream as they finish. One slow catalog cannot
          // delay the initial comparison or the other retailers' observations.
          const publicTask = (async () => {
            const mapped = await nearbyPlaces(p.area, p.radius, "grocery", p.origin);
            const retailers = [...new Set(coverage.map((store) => store.retailer))];
            const outcomes = await Promise.allSettled(retailers.map(async (retailer) =>
              scrapeRetailers(
                coverage.filter((store) => store.retailer === retailer),
                p.items,
                mapped.places,
                retailer === "Trader Joe’s" ? (await planningTask) ?? undefined : undefined,
                request.signal,
                (report) => send({ type: "report", report: normalizeCatalogReport(report, p.items) }),
              ),
            ));
            if (outcomes.some((outcome) => outcome.status === "rejected"))
              throw new Error("A public catalog did not finish.");
          })();
          const providerTask = planningTask.then((agentPlan) => providerReports(
            [...new Set(coverage.map((store) => store.retailer))],
            p.items,
            p.zip,
            true,
            false,
            (report) => send({ type: "report", report: normalizeCatalogReport(report, p.items) }),
            agentPlan ?? undefined,
            false,
            request.signal,
          ));
          const outcomes = await Promise.allSettled([publicTask, providerTask, planNotification]);
          if (outcomes.some((outcome) => outcome.status === "rejected") && !request.signal.aborted)
            send({ type: "sources-error", error: "Some retailer sources did not finish. Available prices are shown." });
          send({ type: "sources-complete" });
        } catch {
          send({
            type: "error",
            error:
              "Website search interrupted. Retry to resume saved collection jobs.",
          });
        } finally {
          if (open) {
            open = false;
            controller.close();
          }
        }
      },
      cancel() {
        /* The bounded collectors may finish saving their existing jobs. */
      },
    }),
    {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    },
  );
}
