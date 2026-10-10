import { input, compareBasket } from "../../../../lib/compare-basket";
import { providerReports } from "../../../../lib/provider-prices";
import { traderJoesObserved } from "../../../../lib/trader-joes";
import { planBasketSearch, type SearchPlan } from "../../../../lib/local-search-agent";
import { normalizeCatalogReport } from "../../../../lib/product-ownership";
import { scrapeRetailers, type ScrapeReport } from "../../../../lib/retailer-scraper";
import { nearbyPlaces } from "../../../../lib/live-data";
import { groceryCoverage } from "../../../../lib/retailer-coverage";
import { mergeCatalogReports } from "../../../../lib/merge-catalog-reports";
import { settlePendingReports } from "../../../../lib/search-state";
import { deadlineStream, untilAborted } from "../../../../lib/deadline-stream";
import { AI_PLAN_WINDOW_MS, SEARCH_WINDOW_MS } from "../../../../lib/search-timing";
import { catalogCache } from "../../../../lib/catalog-cache";

export const runtime = "nodejs";
const supported = ["Walmart", "Target", "Publix", "ALDI", "The Fresh Market",
  "Food Lion", "Sam’s Club", "Sprouts", "Costco", "Albertsons family"];

function waitForProviderPoll(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, 5_000);
    signal.addEventListener("abort", done, { once: true });
  });
}

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success || new Set(parsed.data.items.map((item) => item.id)).size !== parsed.data.items.length)
    return Response.json({ error: "Choose 1–30 distinct foods and a valid search location." }, { status: 400 });
  const p = parsed.data;
  const reports = new Map<string, ScrapeReport>();
  let comparison: Record<string, unknown> | null = null;
  let plan: SearchPlan | null = null;
  let failures = false;

  return deadlineStream(request.signal, async (send, signal) => {
    const emit = (raw: ScrapeReport, cached = false) => {
      if (signal.aborted) return;
      const incoming = normalizeCatalogReport(raw, p.items);
      const previous = reports.get(incoming.retailer);
      const report = previous
        ? normalizeCatalogReport(mergeCatalogReports(previous, incoming), p.items)
        : incoming;
      reports.set(report.retailer, report);
      if (!cached) catalogCache.put(p.zip, incoming);
      send({ type: "report", report, cached });
    };
    send({ type: "started", deadlineMs: SEARCH_WINDOW_MS });
    for (const report of catalogCache.read(p.zip, p.items)) emit(report, true);
    const observed = p.items.map((item) => ({ item, products: traderJoesObserved(item) }));
    if (observed.some((line) => line.products.length)) emit({
      retailer: "Trader Joe’s", status: "retrieved",
      detail: "Dated official website observations. Local branch prices and stock remain unverified.",
      lines: observed,
    }, true);

    // Cache reads, AI understanding and location lookup start together.
    const cachedTask = providerReports(supported, p.items, p.zip, false, true,
      undefined, undefined, false, signal).then((cached) => {
        for (const report of cached) if (report.lines.some((line) => line.products.length)) emit(report, true);
      });
    send({ type: "agent", stage: "planning" });
    const planningSignal = AbortSignal.any([signal, AbortSignal.timeout(AI_PLAN_WINDOW_MS)]);
    const planningTask = untilAborted(planBasketSearch(p.items, planningSignal), planningSignal)
      .catch(() => null).then((value) => {
        if (signal.aborted) return;
        plan = value ?? null;
        send({ type: "agent", stage: plan ? "ready" : "unavailable", provider: plan?.provider, model: plan?.model });
      });
    const mappedTask = nearbyPlaces(p.area, p.radius, "grocery", p.origin);
    const comparisonTask = compareBasket(new Request(request.url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p), signal,
    }), (report) => emit(report), undefined,
    { deferProvider: true, deferPublic: true, deferPlan: true }).then(async (response) => {
      const result = await response.json();
      if (!signal.aborted && response.ok) comparison = result;
      else if (!signal.aborted) failures = true;
    });

    const sourceTask = mappedTask.then(async (mapped) => {
      signal.throwIfAborted();
      const coverage = groceryCoverage(mapped.places);
      // Preserve locations even if a branch-specific price feed is slow.
      comparison ??= { stores: [], storeCoverage: coverage, foundStores: coverage.length,
        checkedAt: new Date().toISOString(), warnings: [],
        coverage: `Discovered ${coverage.length} mapped grocery locations within ${p.radius} miles of ${mapped.origin.label}. Online catalog prices do not establish branch prices.` };
      const retailers = [...new Set(coverage.map((store) => store.retailer))];
      const publicTasks = retailers.map(async (retailer) => {
        if (retailer === "Trader Joe’s") await planningTask;
        signal.throwIfAborted();
        return scrapeRetailers(coverage.filter((store) => store.retailer === retailer),
          p.items, mapped.places, plan ?? undefined, signal, (report) => emit(report));
      });
      const providerTask = planningTask.then(async () => {
        signal.throwIfAborted();
        let current = await providerReports(retailers, p.items, p.zip, true, false,
          (report) => emit(report), plan ?? undefined, false, signal, { fast: true });
        // Bright Data can return a job ID before it has product records. Check
        // that same job during this search; start=false avoids creating another.
        while (!signal.aborted && current.some((report) =>
          report.lines.some((line) => line.searchStatus === "searching"))) {
          await waitForProviderPoll(signal);
          signal.throwIfAborted();
          current = await providerReports(retailers, p.items, p.zip, false, false,
            (report) => emit(report), plan ?? undefined, false, signal, { fast: true });
        }
        return current;
      });
      const outcomes = await Promise.allSettled([...publicTasks, providerTask]);
      if (outcomes.some((outcome) => outcome.status === "rejected")) failures = true;
    });
    const outcomes = await Promise.allSettled([cachedTask, planningTask, comparisonTask, sourceTask]);
    if (outcomes.some((outcome) => outcome.status === "rejected")) failures = true;
  }, (reason, elapsedMs) => {
    const pending = [...reports.values()].some((report) => report.status === "pending" ||
      report.lines.some((line) => line.searchStatus === "searching"));
    const partial = reason !== "completed" || failures || pending;
    const catalogs = settlePendingReports([...reports.values()], "timeout");
    const fallback = {
      stores: [], storeCoverage: [], foundStores: 0, warnings: [],
      checkedAt: new Date().toISOString(),
      coverage: "Nearby location lookup did not finish in this search. Catalog prices are not verified for your local branch.",
    };
    const result = {
      ...(comparison ?? fallback), publicCatalogs: catalogs,
      search: { elapsedMs, partial, timedOut: reason === "timeout" },
      agent: { aiConnected: !!plan,
        mode: plan ? `AI interpreted your list using ${plan.model}. Prices come from retailer sources.`
          : "Searched your product names directly; no AI-generated prices are used." },
    };
    return [{ type: "complete", result }, { type: "sources-complete", elapsedMs, partial,
      timedOut: reason === "timeout" }];
  });
}
