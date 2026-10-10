import { selectFoodMatches } from "./food-alternatives";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentItem } from "./price-agent";
import type { ScrapeReport, ScrapedProduct } from "./retailer-scraper";
import { verifiedProductSources } from "./verified-product-sources";
import { reserveRecords } from "./provider-budget";
import { discoverSources, validDiscoveredSource } from "./ai-source-search";
import type { SearchPlan } from "./local-search-agent";
import { packageMatches, prioritizePackageMatches } from "./package-match";
import { catalogSourceBelongsToRetailer } from "./product-ownership";
import {
  SEARCH_TIMEOUT_MS,
  boundedJobStatus,
  type SearchStatus,
} from "./search-state";

type ProviderConfig = {
  id: string;
  method?: string;
  host: string;
  keyword?: string;
};
const providers: Record<string, ProviderConfig> = {
  Walmart: {
    id: "gd_m693oc1r1gebnayxq",
    method: "keyword",
    host: "www.walmart.com",
    keyword: "keyword",
  },
  Target: {
    id: "gd_ltppk5mx2lp0v1k0vo",
    method: "keywords",
    host: "www.target.com",
    keyword: "keywords",
  },
  Sprouts: { id: "gd_mosh8nanycq1e5r6g", host: "shop.sprouts.com" },
  "Albertsons family": { id: "gd_movisl0r1s0eo3e2tu", host: "www.safeway.com" },
  Costco: { id: "gd_mkcbmac44j178pook", host: "www.costco.com" },
  Publix: { id: "gd_mljhotxi146iliaa3d", host: "www.instacart.com" },
  ALDI: { id: "gd_mljhotxi146iliaa3d", host: "www.instacart.com" },
  "The Fresh Market": {
    id: "gd_mljhotxi146iliaa3d",
    host: "www.instacart.com",
  },
  "Food Lion": { id: "gd_mljhotxi146iliaa3d", host: "www.instacart.com" },
  "Sam’s Club": { id: "gd_mljhotxi146iliaa3d", host: "www.instacart.com" },
};
export type ProviderRetailer = keyof typeof providers;
type Job = {
  id?: string;
  started: number;
  checked: number;
  status: string;
  fallback?: boolean;
  packageFallback?: boolean;
  sourceUrls?: string[];
  stage?: "discovery" | "products";
  products?: ScrapedProduct[];
  error?: string;
};
const directory = path.join(process.cwd(), ".price-jobs");
const locks = new Map<string, Promise<Job>>();
let starts: number[] = [];
export function providerConfigured() {
  return !!process.env.BRIGHT_DATA_API_KEY;
}
export function providerSupports(retailer: string) {
  return providerConfigured() && Object.hasOwn(providers, retailer);
}
export function matchesRequestedFood(name: string, term: string) {
  const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return (term.toLowerCase().match(/[a-z0-9]+/g) ?? []).every((word) =>
    words.some(
      (value) => value === word || value === word + "s" || word === value + "s",
    ),
  );
}
export function needsBroaderCatalogSearch(
  products: ScrapedProduct[],
  item: AgentItem,
): boolean {
  return !products.some(
    (product) =>
      matchesRequestedFood(product.name, item.name) &&
      packageMatches(item.unit, product.size),
  );
}
async function api(endpoint: string, body?: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (body && endpoint.startsWith("trigger?")) {
    const request = body as { input: unknown[]; limit_per_input: number };
    await reserveRecords(request.input.length * request.limit_per_input);
  }
  const response = await fetch(
    `https://api.brightdata.com/datasets/v3/${endpoint}`,
    {
      method: body ? "POST" : "GET",
      redirect: "error",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${process.env.BRIGHT_DATA_API_KEY}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
        : AbortSignal.timeout(25000),
    },
  );
  if (!response.ok)
    throw new Error(`Price provider returned HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > 4_000_000)
    throw new Error("Provider response exceeded size limit.");
  return JSON.parse(text);
}
export function parseProviderProducts(
  raw: unknown,
  host: string,
  now = new Date().toISOString(),
  retailer?: string,
): ScrapedProduct[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p) => {
    if (!p || typeof p !== "object" || p.error) return [];
    const name = p.product_name ?? p.title ?? p.name;
    const advertised = p.final_price ?? p.sale_price ?? p.price;
    const usDollar =
      typeof advertised === "string" &&
      /^\$\d+(?:\.\d{1,2})?$/.test(advertised) &&
      (p.currency === "USD" ||
        (typeof p.store_country === "string" &&
          p.store_country.toLowerCase() === "us" &&
          !p.currency));
    const price = usDollar ? Number(advertised.slice(1)) : advertised;
    if (
      typeof name !== "string" ||
      typeof price !== "number" ||
      price <= 0 ||
      price > 1000 ||
      (p.currency !== "USD" && !usDollar) ||
      p.availability === "out_of_stock"
    )
      return [];
    let url: URL;
    try {
      url = new URL(p.url);
    } catch {
      return [];
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hostname.replace(/^www\./, "") !== host.replace(/^www\./, "") ||
      (retailer && !catalogSourceBelongsToRetailer(retailer, url.href))
    )
      return [];
    const specs = Array.isArray(p.specifications)
      ? p.specifications
      : Array.isArray(p.product_specifications)
        ? p.product_specifications
        : [];
    const packageText =
      `${name} ${typeof p.description === "string" ? p.description : ""} ${url.pathname.replace(/-/g, " ")}`.replace(
        /\b(\d+(?:\.\d+)?)\s+gl\b/gi,
        "$1 gallon",
      );
    const size =
      p.size_unit ??
      specs.find((s: { name?: string; key?: string }) =>
        /size|net weight|count|volume/i.test(s.name ?? s.key ?? ""),
      )?.value ??
      packageText.match(
        /\b\d+(?:\.\d+)?\s*(?:fl\.?\s*oz|oz|gallon|gal|lb|lbs|count|ct|dozen|kg|ml|liter|litre)\b/i,
      )?.[0];
    // An ambiguous or missing package must not become a purchasable basket item.
    if (
      typeof size !== "string" ||
      !size.trim() ||
      Math.round(price * 100) < 1 ||
      p.listing_has_variations === true ||
      (Array.isArray(p.variants) && p.variants.length > 1)
    )
      return [];
    const imageCandidate =
      p.main_image ?? p.image_url ?? p.image ?? p.images?.[0];
    let imageUrl: string | undefined;
    if (typeof imageCandidate === "string") {
      try {
        const image = new URL(imageCandidate);
        if (image.protocol === "https:" && !image.username && !image.password)
          imageUrl = image.href;
      } catch {}
    }
    return [
      {
        id: String(p.product_id ?? p.sku ?? url.pathname),
        name,
        brand: String(p.brand ?? p.product_brand ?? ""),
        size,
        priceCents: Math.round(price * 100),
        sourceUrl: url.toString(),
        imageUrl,
        retrievedAt: now,
      },
    ];
  });
}
async function job(
  retailer: ProviderRetailer,
  item: AgentItem,
  zip: string,
  start: boolean,
  cacheOnly = false,
  plan?: SearchPlan,
  broadenUnmatched = false,
  signal?: AbortSignal,
  fast = false,
): Promise<Job> {
  signal?.throwIfAborted();
  const config = providers[retailer];
  let configuredUrls: string[] = [];
  if (!config.keyword) {
    let sources: Record<string, Record<string, string[]>> = {};
    try {
      sources = JSON.parse(process.env.BRIGHT_DATA_PRODUCT_URLS ?? "{}");
    } catch {}
    const configured =
      sources[retailer]?.[item.name.toLowerCase()] ??
      verifiedProductSources[retailer]?.[item.name.toLowerCase()];
    const seedUrls = (Array.isArray(configured) ? configured : [])
      .filter((value) => {
        try {
          const u = new URL(value);
          return (
            u.protocol === "https:" &&
            !u.username &&
            !u.password &&
            u.hostname.replace(/^www\./, "") ===
              config.host.replace(/^www\./, "") &&
            (config.host !== "www.instacart.com" ||
              validDiscoveredSource(retailer, value))
          );
        } catch {
          return false;
        }
      })
      .slice(0, 3);
    await mkdir(directory, { recursive: true });
    const sourceKey = createHash("sha256")
      .update(`sources:${retailer}:${zip}:${item.name.toLowerCase()}`)
      .digest("hex");
    const sourceFile = path.join(directory, `sources-${sourceKey}.json`);
    let discoveredUrls: string[] = [];
    let discoveryCached = false;
    try {
      const cached = JSON.parse(await readFile(sourceFile, "utf8"));
      if (Date.now() - cached.at < 86400000 && Array.isArray(cached.urls)) {
        discoveryCached = true;
        discoveredUrls = cached.urls.filter((value: string) =>
          validDiscoveredSource(retailer, value),
        );
      }
    } catch {}
    // Search the requested food even when a known product URL exists. Seeds are
    // fallbacks, not a replacement for searching the wider product catalog.
    if (!discoveryCached && start && !cacheOnly && (!fast || !seedUrls.length)) {
      try {
        discoveredUrls = await discoverSources(retailer, item, zip, plan, {
          signal,
        });
        signal?.throwIfAborted();
        await writeFile(
          sourceFile,
          JSON.stringify({ at: Date.now(), urls: discoveredUrls }),
        );
      } catch {
        // A verified seed can still be collected when source discovery fails.
      }
    }
    configuredUrls = [...new Set([...discoveredUrls, ...seedUrls])].slice(0, 3);
    if (!configuredUrls.length)
      return {
        started: Date.now(),
        checked: Date.now(),
        status: "source_needed",
        error:
          "A verified product URL for this retailer and item is required before this adapter can retrieve prices. No prices assumed.",
      };
  }
  const version = config.id === "gd_mljhotxi146iliaa3d" ? `:${config.id}` : "";
  const key = createHash("sha256")
    .update(
      `${retailer}:${zip}:${item.name.toLowerCase()}:${configuredUrls.join(",")}${version}`,
    )
    .digest("hex");
  // A cache read must never join a network job already running for this item.
  if (cacheOnly) {
    try { return JSON.parse(await readFile(path.join(directory, `${key}.json`), "utf8")); }
    catch { return { started: Date.now(), checked: Date.now(), status: "not_requested" }; }
  }
  if (locks.has(key)) return locks.get(key)!;
  const task = (async () => {
    await mkdir(directory, { recursive: true });
    const filename = path.join(directory, `${key}.json`);
    let saved: Job | undefined;
    try {
      saved = JSON.parse(await readFile(filename, "utf8"));
    } catch {}
    const now = Date.now();
    if (cacheOnly)
      return saved ?? { started: now, checked: now, status: "not_requested" };
    if (
      start &&
      saved?.id &&
      ["running", "starting", "pending"].includes(saved.status) &&
      now - saved.started >= SEARCH_TIMEOUT_MS
    )
      saved = undefined;
    if (
      !fast && (start || broadenUnmatched) &&
      (saved?.status === "ready" || saved?.status === "failed") &&
      !saved.packageFallback &&
      !config.keyword &&
      needsBroaderCatalogSearch(saved.products ?? [], item)
    ) {
      saved.packageFallback = true;
      const extraUrls = await discoverSources(retailer, item, zip, plan, {
        broader: true,
        exclude: saved.sourceUrls ?? configuredUrls,
        signal,
      }).catch(() => []);
      if (extraUrls.length) {
        const next = await api(
          `trigger?dataset_id=${config.id}&format=json&include_errors=true`,
          {
            input: extraUrls.map((url) => ({ url })),
            limit_per_input: 1,
          },
          signal,
        );
        if (/^s[d]?_[a-z0-9]+$/.test(next.snapshot_id ?? "")) {
          saved.id = next.snapshot_id;
          saved.status = "running";
          saved.stage = "products";
          saved.error = undefined;
          saved.sourceUrls = [
            ...new Set([...(saved.sourceUrls ?? configuredUrls), ...extraUrls]),
          ];
          saved.checked = now;
        }
      }
      await writeFile(filename, JSON.stringify(saved));
      return saved;
    }
    if (!start && saved?.status === "ready" && saved.products?.length)
      return saved;
    if (
      saved?.status === "ready" &&
      saved.products?.length &&
      now - saved.started < 900000
    )
      return saved;
    if (
      saved?.id &&
      saved.status !== "ready" &&
      now - saved.started < 3600000
    ) {
      if (
        now - saved.checked < 15000 ||
        saved.status === "canceled" ||
        (saved.status === "failed" &&
          (saved.fallback || !["Walmart", "Target"].includes(retailer)))
      )
        return saved;
      const state = await api(`progress/${saved.id}`, undefined, signal);
      saved.checked = now;
      saved.status = state.status;
      if (state.status === "ready") {
        const raw = await api(
          `snapshot/${saved.id}?format=json`,
          undefined,
          signal,
        );
        const freshProducts = parseProviderProducts(
          raw,
          config.host,
          undefined,
          retailer,
        );
        saved.products = [
          ...new Map(
            [...(saved.products ?? []), ...freshProducts].map((product) => [
              product.sourceUrl,
              product,
            ]),
          ).values(),
        ];
        if (
          !saved.products.length &&
          Array.isArray(raw) &&
          raw.some((p) => p?.error)
        ) {
          saved.status = "failed";
          saved.error =
            "The provider returned unusable product records. No price assumed.";
        }
        // Discovery returns URLs, not product prices. Collect those URLs once.
        if (
          saved.stage !== "products" &&
          !saved.products.length &&
          Array.isArray(raw)
        ) {
          const urls = raw
            .flatMap((p) => {
              try {
                const u = new URL(p.url);
                return u.protocol === "https:" &&
                  u.hostname.replace(/^www\./, "") ===
                    config.host.replace(/^www\./, "") &&
                  !u.username &&
                  !u.password
                  ? [u.toString()]
                  : [];
              } catch {
                return [];
              }
            })
            .slice(0, 3);
          if (urls.length) {
            const next = await api(
              `trigger?dataset_id=${config.id}&format=json&include_errors=true`,
              {
                input: urls.map((url) => ({
                  url,
                  ...(retailer === "Walmart"
                    ? { zip_code: zip }
                    : retailer === "Target"
                      ? { zipcode: zip }
                      : {}),
                })),
                limit_per_input: 1,
              },
              signal,
            );
            if (!/^s[d]?_[a-z0-9]+$/.test(next.snapshot_id ?? ""))
              throw new Error("Invalid product job.");
            saved.id = next.snapshot_id;
            saved.stage = "products";
            saved.status = "running";
          }
        }
      }
      if (state.status === "failed")
        saved.error = "Provider collection failed; no price assumed.";
      if (
        ["failed", "ready"].includes(saved.status) &&
        !saved.products?.length &&
        !saved.fallback &&
        ["Walmart", "Target"].includes(retailer)
      ) {
        const fallbackId =
          retailer === "Walmart" ? "gd_l95fol7l1ru6rlo116" : config.id;
        const fallbackInput =
          retailer === "Walmart"
            ? {
                keyword: item.name,
                domain: "https://www.walmart.com",
                all_variations: false,
              }
            : { keywords: item.name, all_variations: false };
        const next = await api(
          `trigger?dataset_id=${fallbackId}&type=discover_new&discover_by=${config.method}&format=json&include_errors=true`,
          { input: [fallbackInput], limit_per_input: 3 },
          signal,
        );
        if (!/^s[d]?_[a-z0-9]+$/.test(next.snapshot_id ?? ""))
          throw new Error("Invalid fallback collection job.");
        saved.id = next.snapshot_id;
        saved.fallback = true;
        saved.stage = "products";
        saved.status = "running";
        saved.error = undefined;
      }
      await writeFile(filename, JSON.stringify(saved));
      return saved;
    }
    if (!start) return { started: now, checked: now, status: "not_requested" };
    starts = starts.filter((t) => now - t < 86400000);
    // Free-only setup: tightly bound records and requests; never auto-add funds.
    if (
      starts.length >= 100 ||
      starts.filter((t) => now - t < 60000).length >= 15
    )
      return { started: now, checked: now, status: "limited" };
    starts.push(now);
    const input = config.keyword
      ? [
          {
            [config.keyword]: item.name,
            ...(retailer === "Walmart"
              ? { zip_code: zip }
              : retailer === "Target"
                ? { zipcode: zip }
                : {}),
          },
        ]
      : configuredUrls.map((url) => ({ url }));
    const result = await api(
      `trigger?dataset_id=${config.id}${config.method ? `&type=discover_new&discover_by=${config.method}` : ""}&format=json&include_errors=true`,
      { input, limit_per_input: 3 },
      signal,
    );
    if (!/^s[d]?_[a-z0-9]+$/.test(result.snapshot_id ?? ""))
      throw new Error("Provider did not return a valid job.");
    saved = {
      id: result.snapshot_id,
      started: now,
      checked: now,
      status: "running",
      stage: config.method ? "discovery" : "products",
      products: saved?.products,
      sourceUrls: configuredUrls,
    };
    await writeFile(filename, JSON.stringify(saved));
    return saved;
  })();
  locks.set(key, task);
  try {
    return await task;
  } finally {
    locks.delete(key);
  }
}
export async function providerReports(
  retailers: string[],
  items: AgentItem[],
  zip: string,
  start = true,
  cacheOnly = false,
  onReport?: (report: ScrapeReport) => void,
  plan?: SearchPlan,
  broadenUnmatched = false,
  signal?: AbortSignal,
  options: { fast?: boolean } = {},
): Promise<ScrapeReport[]> {
  if (!providerConfigured()) return [];
  const supported = [...new Set(retailers)].filter((retailer) =>
    Object.hasOwn(providers, retailer),
  );
  // Bound parallel website collection rather than waiting for every item in sequence.
  const tasks = items.flatMap((item) =>
    supported.map((retailer) => ({ retailer, item })),
  );
  const lines = new Map<string, ScrapeReport["lines"]>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(6, tasks.length) }, async () => {
      while (cursor < tasks.length) {
        if (signal?.aborted) break;
        const { retailer, item } = tasks[cursor++];
        let line: ScrapeReport["lines"][number];
        try {
          const rawState = await job(
            retailer as ProviderRetailer,
            item,
            zip,
            start,
            cacheOnly,
            plan,
            broadenUnmatched,
            signal,
            options.fast,
          );
          const state =
            boundedJobStatus(rawState.status, rawState.started) === "timeout"
              ? {
                  ...rawState,
                  status: "timeout",
                  error: "Search timed out. Retry this store search.",
                }
              : rawState;
          const ownedProducts = (state.products ?? []).filter((product) =>
            catalogSourceBelongsToRetailer(retailer, product.sourceUrl),
          );
          const products = prioritizePackageMatches(
            selectFoodMatches(ownedProducts, item.name, matchesRequestedFood),
            item.unit,
          );
          const searchStatus: SearchStatus = products.length
            ? "completed"
            : state.status === "timeout"
              ? "timeout"
              : ["running", "starting", "pending"].includes(state.status)
                ? "searching"
                : state.status === "ready"
                  ? "no_results"
                  : ["source_needed", "not_requested"].includes(state.status)
                    ? "integration_unavailable"
                    : state.status === "limited"
                      ? "price_unavailable"
                      : "error";
          line = {
            item,
            products,
            searchStatus,
            ...(!options.fast && (state.status === "ready" || state.status === "failed") &&
            !state.packageFallback &&
            needsBroaderCatalogSearch(state.products ?? [], item) &&
            !Object.hasOwn(providers[retailer], "keyword")
              ? {
                  error:
                    "Broader catalog search queued for the requested package.",
                }
              : state.status !== "ready"
                ? {
                    error:
                      state.error ??
                      `Collection ${state.status}. Refresh to check existing work.`,
                  }
                : {}),
          };
        } catch {
          line = {
            item,
            products: [],
            error: signal?.aborted ? "Source missed the search deadline. Retry to check again." : "Website collection failed. No price assumed.",
            searchStatus: signal?.aborted ? "timeout" : "error",
          };
        }
        const group = lines.get(retailer) ?? [];
        group.push(line);
        lines.set(retailer, group);
        onReport?.({
          retailer,
          status: group.some((l) => l.products.length)
            ? "retrieved"
            : group.length < items.length ||
                group.some((l) => l.searchStatus === "searching")
              ? "pending"
              : "failed",
          detail:
            "Website search in progress. Branch prices remain unverified.",
          lines: items.map(
            (i) =>
              group.find((l) => l.item.id === i.id) ?? {
                item: i,
                products: [],
                error: "Waiting for website search.",
                searchStatus: "searching",
              },
          ),
        });
      }
    }),
  );
  signal?.throwIfAborted();
  return supported.map((retailer) => {
    const ordered = items.map((item) =>
      lines.get(retailer)!.find((line) => line.item.id === item.id)!,
    );
    return {
      retailer,
      status: ordered.some((l) => l.products.length)
        ? "retrieved"
        : ordered.some((l) => l.searchStatus === "searching")
          ? "pending"
          : "failed",
      detail: `Website collection for ZIP ${zip}. Advertised online prices; branch, stock and in-store price equivalence are unverified. Excluded from trip rankings.`,
      lines: ordered,
    };
  });
}
