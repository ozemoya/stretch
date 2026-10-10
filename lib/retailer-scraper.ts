import { traderJoesReport } from "./trader-joes";
import type { SearchPlan } from "./local-search-agent";
import { load } from "cheerio";
import { z } from "zod";
import type { AgentItem } from "./price-agent";
import type { StoreCoverage } from "./retailer-coverage";
import type { NearbyPlace } from "./live-data";
import { freshMarketSpecials } from "./fresh-market-specials";

export type ScrapedProduct = {
  id: string;
  name: string;
  brand: string;
  size: string;
  priceCents: number;
  sourceUrl: string;
  imageUrl?: string;
  matchKind?: "alternative";
  verification?: "official-page-observation";
  retrievedAt: string;
};
export type ScrapeReport = {
  retailer: string;
  status: "retrieved" | "pending" | "failed" | "unsupported" | "blocked";
  detail: string;
  lines: { item: AgentItem; products: ScrapedProduct[]; error?: string }[];
};
const product = z.object({
  productId: z.union([z.number(), z.string()]),
  fullTitle: z.string().min(1).max(300),
  canonicalPath: z.string(),
  brand: z.object({ name: z.string() }).optional(),
  price: z.object({
    currencyCode: z.literal("USD"),
    price: z.number().positive().max(1000),
    variantsHaveDifferentPrices: z.boolean().optional(),
    packaging: z.object({ text: z.string().min(1).max(100) }),
  }),
});

// Parse public rendered product tiles, never aggregate/category or per-unit prices.
export function parseLidlProducts(
  html: string,
  term: string,
  retrievedAt: string,
): ScrapedProduct[] {
  const $ = load(html),
    found = new Map<string, ScrapedProduct>();
  const tokens = term
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.replace(/s$/, ""));
  $("[data-grid-data]").each((_, el) => {
    let raw: unknown;
    try {
      raw = JSON.parse($(el).attr("data-grid-data") ?? "");
    } catch {
      return;
    }
    const parsed = product.safeParse(raw);
    if (!parsed.success) return;
    const p = parsed.data;
    if (
      p.price.variantsHaveDifferentPrices ||
      !/^\/p\/[a-z0-9-]+\/p\d+$/.test(p.canonicalPath)
    )
      return;
    const words = p.fullTitle
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .map((t) => t.replace(/s$/, ""));
    if (!tokens.length || !tokens.every((t) => words.includes(t))) return;
    const id = String(p.productId);
    found.set(id, {
      id,
      name: p.fullTitle,
      brand: p.brand?.name ?? "Lidl",
      size: p.price.packaging.text,
      priceCents: Math.round(p.price.price * 100),
      sourceUrl: `https://www.lidl.com${p.canonicalPath}`,
      retrievedAt,
    });
  });
  return [...found.values()].slice(0, 8);
}

const cache = new Map<
  string,
  { expires: number; products: ScrapedProduct[] }
>();
const pending = new Map<string, Promise<ScrapedProduct[]>>();
let windowStart = 0,
  count = 0,
  dayStart = 0,
  dayCount = 0;
let robotsUntil = 0;
async function publicHtml(path: string, maxBytes = 6_000_000) {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    count = 0;
  }
  if (now - dayStart >= 86_400_000) {
    dayStart = now;
    dayCount = 0;
  }
  if (count >= 15 || dayCount >= 150)
    throw new Error("Public catalog request limit reached. Try again later.");
  count++;
  dayCount++;
  const response = await fetch(`https://www.lidl.com${path}`, {
    headers: {
      "User-Agent": "Stretch/1.0 (+https://github.com/ozemoya/stretch)",
      Accept: "text/html,text/plain",
    },
    signal: AbortSignal.timeout(15000),
    redirect: "error",
    cache: "no-store",
  });
  if (!response.ok || !response.body)
    throw new Error(
      "Retailer page unavailable or blocked. No price was inferred.",
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0,
    html = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxBytes)
        throw new Error("Retailer page exceeded the size limit.");
      html += decoder.decode(value, { stream: true });
    }
    return html + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}
async function searchLidl(term: string): Promise<ScrapedProduct[]> {
  const key = term.toLowerCase().trim();
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.products;
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async () => {
    if (robotsUntil < Date.now()) {
      const robots = await publicHtml("/robots.txt", 100_000);
      // Fail closed if the site's generic rules change; no anti-bot or login bypass.
      const generic = robots.match(
        /User-agent:\s*\*\s*([\s\S]*?)(?=User-agent:|$)/i,
      )?.[1];
      if (
        !generic ||
        generic
          .split(/\n/)
          .some(
            (l) =>
              /^\s*Disallow:/i.test(l) &&
              l.split(":").slice(1).join(":").trim() !== "",
          )
      )
        throw new Error("Retailer crawling rules need review before scraping.");
      robotsUntil = Date.now() + 600_000;
    }
    const html = await publicHtml(`/q/search?q=${encodeURIComponent(key)}`);
    if (!html.includes("data-grid-data"))
      throw new Error("Retailer did not return readable product tiles.");
    const products = parseLidlProducts(html, key, new Date().toISOString());
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 300_000, products });
    return products;
  })();
  pending.set(key, task);
  try {
    return await task;
  } finally {
    pending.delete(key);
  }
}
export async function scrapeRetailers(
  stores: StoreCoverage[],
  items: AgentItem[],
  places: NearbyPlace[] = [],
  plan?: SearchPlan,
): Promise<ScrapeReport[]> {
  const reports: ScrapeReport[] = [];
  for (const retailer of new Set(stores.map((s) => s.retailer))) {
    if (retailer === "Trader Joe’s") { reports.push(await traderJoesReport(items,plan)); continue; }
    if (retailer === "The Fresh Market") {
      try {
        reports.push(await freshMarketSpecials(places, items));
      } catch {
        reports.push({
          retailer,
          status: "failed",
          detail:
            "Weekly offer source could not be retrieved. Prices remain unknown.",
          lines: [],
        });
      }
      continue;
    }
    if (retailer !== "Lidl") {
      reports.push({
        retailer,
        status: ["ALDI", "Sprouts", "Walmart", "Trader Joe’s"].includes(
          retailer,
        )
          ? "blocked"
          : "unsupported",
        detail:
          retailer === "ALDI"
            ? "ALDI's generic robots rules disallow automated crawling. No prices scraped."
            : retailer === "Sprouts"
              ? "Sprouts' online shop restricts automated crawling. A permitted feed or retailer access is required."
              : retailer === "Walmart"
                ? "Public product page returned a bot challenge. No prices scraped; store-selected access is required."
                : retailer === "Trader Joe’s"
                  ? "Public catalog endpoint denied automated access. No prices scraped."
                  : retailer === "Kroger family"
                    ? "Branch-specific product integration is implemented. Activate it with a Kroger developer client ID and secret."
                    : "No working public scraper connected for this retailer. Local prices remain unknown.",
        lines: [],
      });
      continue;
    }
    const lines: ScrapeReport["lines"] = [];
    for (const [index, item] of items.entries()) {
      if (index >= 12) {
        lines.push({
          item,
          products: [],
          error: "Not searched: twelve-item public catalog limit per run.",
        });
        continue;
      }
      try {
        lines.push({ item, products: await searchLidl(item.name) });
      } catch (e) {
        lines.push({
          item,
          products: [],
          error: e instanceof Error ? e.message : "Public price search failed.",
        });
      }
    }
    reports.push({
      retailer,
      status: lines.some((l) => l.products.length) ? "retrieved" : "failed",
      detail:
        "Live public US catalog, cached up to five minutes. Default website region; nearby branch prices, stock, dietary suitability and package equivalence are unverified. Excluded from local trip rankings.",
      lines,
    });
  }
  return reports;
}
