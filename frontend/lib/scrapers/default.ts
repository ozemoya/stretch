import { load } from "cheerio";
import { discoverSources } from "../ai-source-search";
import { catalogSourceBelongsToRetailer } from "../product-ownership";
import { providerReports, providerSupports, matchesRequestedFood } from "../provider-prices";
import { verifiedProductSources } from "../verified-product-sources";
import { robotsAllows } from "../robots-rules";
import type { RetailerScraper, ScrapedProduct } from "./types";

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
const list = (value: unknown) => Array.isArray(value) ? value : [value];
const typed = (value: JsonObject, type: string) => list(value["@type"])
  .some((entry) => entry === type || entry === `https://schema.org/${type}` || entry === `http://schema.org/${type}`);

/** Read Product/Offer JSON-LD only. Aggregate, unit, conditional and variant prices aren't package prices. */
export function parseGenericProducts(html: string, url: string, retailer: string, term: string,
  retrievedAt = new Date().toISOString()): ScrapedProduct[] {
  if (!catalogSourceBelongsToRetailer(retailer, url)) return [];
  const $ = load(html), found = new Map<string, ScrapedProduct>();
  const visit = (value: unknown, depth = 0) => {
    if (depth > 20) return;
    if (Array.isArray(value)) { value.forEach((entry) => visit(entry, depth + 1)); return; }
    const p = object(value);
    if (!p) return;
    if (typed(p, "Product") && typeof p.name === "string" && matchesRequestedFood(p.name, term)) {
      const sizeValue = typeof p.size === "string" ? p.size : object(p.size)?.name;
      const size = typeof sizeValue === "string" ? sizeValue : "";
      const offers = list(p.offers).map(object).filter((offer): offer is JsonObject => !!offer);
      const prices = offers.flatMap((offer) => {
        if (!typed(offer, "Offer") || offer.priceCurrency !== "USD" || offer.priceSpecification ||
          offer.eligibleQuantity || offer.validForMemberTier ||
          /OutOfStock|Discontinued|PreOrder|SoldOut/.test(String(offer.availability ?? ""))) return [];
        const raw = offer.price;
        if (typeof raw !== "number" && (typeof raw !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(raw))) return [];
        const price = Number(raw);
        if (!Number.isFinite(price) || price <= 0 || price > 1000) return [];
        if (offer.priceValidUntil && Date.parse(String(offer.priceValidUntil)) < Date.parse(retrievedAt)) return [];
        try {
          const sourceUrl = new URL(String(offer.url ?? p.url ?? url), url).href;
          if (!catalogSourceBelongsToRetailer(retailer, sourceUrl) || new URL(sourceUrl).pathname === "/") return [];
          return [{ priceCents: Math.round(price * 100), sourceUrl }];
        } catch { return []; }
      });
      // Different prices can mean different sellers or variants; a dedicated adapter must resolve them.
      if (size && prices.length && new Set(prices.map((offer) => offer.priceCents)).size === 1) {
        const chosen = prices[0], id = String(p.sku ?? p.productID ?? chosen.sourceUrl);
        const brand = typeof p.brand === "string" ? p.brand : object(p.brand)?.name;
        found.set(`${id}:${chosen.sourceUrl}`, { id, name: p.name, brand: typeof brand === "string" ? brand : retailer,
          size, ...chosen, retrievedAt });
      }
    }
    for (const [key, child] of Object.entries(p)) if (key !== "@context") visit(child, depth + 1);
  };
  $('script[type="application/ld+json"]').each((_, element) => {
    try { visit(JSON.parse($(element).text())); } catch { /* Ignore malformed markup. */ }
  });
  return [...found.values()].slice(0, 8);
}

const cache = new Map<string, { until: number; products: ScrapedProduct[] }>();
const usage = new Map<string, { minute: number; recent: number; day: number; total: number }>();
async function readPage(url: string, signal?: AbortSignal, maxBytes = 2_000_000) {
  signal?.throwIfAborted();
  const host = new URL(url).hostname, minute = Math.floor(Date.now() / 60_000), day = Math.floor(Date.now() / 86_400_000);
  const prior = usage.get(host);
  const recent = prior?.minute === minute ? prior.recent : 0, total = prior?.day === day ? prior.total : 0;
  if (recent >= 15 || total >= 150) throw new Error("Public catalog request limit reached.");
  usage.set(host, { minute, day, recent: recent + 1, total: total + 1 });
  const response = await fetch(url, { redirect: "error", cache: "no-store",
    headers: { "User-Agent": "Stretch/1.0 (+https://github.com/ozemoya/stretch)" },
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000) });
  if (!response.ok || !response.body) throw new Error("Retailer page unavailable.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.length;
      if (bytes > maxBytes) throw new Error("Retailer page exceeded the size limit.");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

export const defaultScraper: RetailerScraper = {
  id: "default",
  async scrape(context) {
    const { retailer, items, zip, plan, signal, fast, onReport } = context;
    if (providerSupports(retailer)) {
      const reports = await providerReports([retailer], items, zip, true, false, onReport, plan, false, signal, { fast });
      if (reports[0]) return reports[0];
    }
    const lines = [];
    for (const [index, item] of items.entries()) {
      signal?.throwIfAborted();
      try {
        if (index >= 12) throw new Error("Twelve-item public catalog limit per run.");
        const key = JSON.stringify([retailer, zip, item.name, item.unit]);
        const hit = cache.get(key);
        if (hit && hit.until > Date.now()) { lines.push({ item, products: hit.products }); continue; }
        const known = verifiedProductSources[retailer]?.[item.name.toLowerCase()] ?? [];
        const urls = known.length ? known : await discoverSources(retailer, item, zip, plan, { signal });
        const products: ScrapedProduct[] = [];
        for (const url of [...new Set(urls)].slice(0, 3)) {
          if (!catalogSourceBelongsToRetailer(retailer, url)) continue;
          const rules = await readPage(new URL("/robots.txt", url).href, signal, 100_000);
          if (!robotsAllows(rules, url)) continue;
          products.push(...parseGenericProducts(await readPage(url, signal), url, retailer, item.name));
        }
        if (products.length) {
          if (cache.size >= 100) cache.delete(cache.keys().next().value!);
          cache.set(key, { until: Date.now() + 300_000, products });
        }
        lines.push({ item, products, ...(!products.length ? { error: "No verified product page with a readable package price was found." } : {}) });
      } catch (error) {
        signal?.throwIfAborted();
        lines.push({ item, products: [], error: error instanceof Error ? error.message : "Public catalog search failed." });
      }
    }
    return { retailer, status: lines.some((line) => line.products.length) ? "retrieved" : "failed",
      detail: "Public product catalog. Online prices may differ in-store.", lines };
  },
};
