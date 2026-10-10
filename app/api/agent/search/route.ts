import {
  input,
  compareBasket as compare,
} from "../../../../lib/compare-basket";
import { providerReports } from "../../../../lib/provider-prices";
import { traderJoesObserved } from "../../../../lib/trader-joes";
import {
  planBasketSearch,
  reviewProductMatches,
} from "../../../../lib/local-search-agent";
import { normalizeCatalogReport } from "../../../../lib/product-ownership";
import type { ScrapeReport } from "../../../../lib/retailer-scraper";
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
          if (tjLines.some((line) => line.products.length))
            send({
              type: "report",
              cached: true,
              report: normalizeCatalogReport(
                {
                  retailer: "Trader Joe’s",
                  status: "retrieved",
                  detail:
                    "Dated official website observations. Nearby branch presence is being checked.",
                  lines: tjLines,
                },
                p.items,
              ),
            });
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
          const agentPlan = await planBasketSearch(p.items);
          request.signal.throwIfAborted();
          send({
            type: "agent",
            stage: agentPlan ? "ready" : "unavailable",
            provider: agentPlan?.provider,
            model: agentPlan?.model,
          });
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
            agentPlan ?? undefined,
          );
          const result = await response.json();
          if (
            response.ok &&
            agentPlan &&
            Array.isArray(result.publicCatalogs)
          ) {
            send({ type: "agent", stage: "reviewing" });
            const reviewed = await reviewProductMatches(result.publicCatalogs);
            result.publicCatalogs = reviewed.reports;
            result.publicCatalogs = result.publicCatalogs.map(
              (report: ScrapeReport) => normalizeCatalogReport(report, p.items),
            );
            result.agent = {
              ...result.agent,
              reviewedMatches: reviewed.reviewed,
            };
            send({
              type: "agent",
              stage: "reviewed",
              reviewedMatches: reviewed.reviewed,
            });
          }
          send(
            response.ok
              ? { type: "complete", result }
              : { type: "error", error: result.error },
          );
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
