import { load } from "cheerio";
import { z } from "zod";
import {
  matchesRequestedFood,
  providerReports,
  providerSupports,
} from "../provider-prices";
import { robotsAllows } from "../robots-rules";
import type { RetailerScraper, ScrapedProduct, ScrapeReport } from "./types";

const pageUrl = "https://www.publix.com/savings/weekly-ad/view-all";
const savingsUrl =
  "https://services.publix.com/api/v4/savings?smImg=235&enImg=368&fallbackImg=false&isMobile=false&page=1&pageSize=0&includePersonalizedDeals=false&languageID=1&isWeb=true&getSavingType=WeeklyAd";
const offerSchema = z.object({
  waId: z.number().int(),
  title: z.string().min(1),
  description: z.string(),
  savings: z.string(),
  brand: z.string().nullish(),
  savingType: z.literal("WeeklyAd"),
  minimumPurchase: z.number().min(0).max(1),
  isSneakPeek: z.literal(false),
  wa_startDate: z.string(),
  wa_endDate: z.string(),
  wa_postStartDate: z.string(),
  wa_postEndDate: z.string(),
  WA_promotionSaleStartDate: z.string(),
  WA_promotionSaleEndDate: z.string(),
  finePrint: z.string().nullish(),
  Terms: z.string().nullish(),
  additionalDealInfo: z.string().nullish(),
});
const decode = (text: string) => load(text).text().replace(/\s+/g, " ").trim();

/** Only unambiguous, unconditional package totals from the anonymous weekly ad. */
export function parsePublixSavings(
  raw: unknown,
  storeNumber: string,
  retrievedAt = new Date().toISOString(),
  now = new Date(),
): ScrapedProduct[] {
  if (
    !/^[1-9]\d{0,4}$/.test(storeNumber) ||
    !Number.isFinite(Date.parse(retrievedAt))
  )
    return [];
  const payload = z
    .object({ Savings: z.array(z.unknown()).max(5000) })
    .safeParse(raw);
  if (!payload.success)
    throw new Error("Publix did not return readable weekly-ad offers.");
  const found = new Map<string, ScrapedProduct>();
  for (const value of payload.data.Savings) {
    const parsed = offerSchema.safeParse(value);
    if (!parsed.success) continue;
    const p = parsed.data;
    const periods = [
      [p.wa_startDate, p.wa_endDate],
      [p.wa_postStartDate, p.wa_postEndDate],
      [p.WA_promotionSaleStartDate, p.WA_promotionSaleEndDate],
    ];
    if (
      !periods.every(
        ([from, to]) =>
          Number.isFinite(Date.parse(from)) &&
          Number.isFinite(Date.parse(to)) &&
          Date.parse(from) <= now.getTime() &&
          now.getTime() <= Date.parse(to),
      )
    )
      continue;
    const price = decode(p.savings).match(
      /^\$(\d+(?:\.\d{2})?)(?:\s+ea\.?)?$/i,
    );
    if (!price) continue; // BOGO, multibuy, savings amounts and weight rates are not package totals.
    const priceCents = Math.round(Number(price[1]) * 100);
    if (priceCents <= 0 || priceCents > 100_000) continue;
    const name = decode(p.title),
      description = decode(p.description);
    if (
      /coupon|with\s+(?:purchase|card)|must\s+buy|minimum\s+purchase|members?\s+only/i.test(
        decode(
          [name, description, p.finePrint, p.Terms, p.additionalDealInfo]
            .filter(Boolean)
            .join(" "),
        ),
      )
    )
      continue;
    // Do not choose a size or a product from a range or a list of alternatives.
    if (/\bor\b|\d\s*(?:to|[-–]|x|×)\s*\d/i.test(`${name} ${description}`))
      continue;
    const sizes = [
      ...description.matchAll(
        /\b(\d+(?:\.\d+)?)\s*[- ]?\s*(fl\.?\s*oz|oz|lbs?|ct|gal|gallons?)\b/gi,
      ),
    ];
    if (sizes.length !== 1 || Number(sizes[0][1]) <= 0) continue;
    const size = `${sizes[0][1]} ${sizes[0][2].toLowerCase().replace(/fl\.?\s*oz/, "fl oz")}`;
    const id = `publix-${storeNumber}-${p.waId}`;
    found.set(id, {
      id,
      name,
      brand: p.brand ? decode(p.brand) : "Publix",
      size,
      priceCents,
      sourceUrl: `https://www.publix.com/savings/weekly-ad?path=printlistingdetail/${p.waId}&storenum=${storeNumber}`,
      retrievedAt,
    });
  }
  return [...found.values()];
}

class CrawlingRestricted extends Error {}
let usage = { minute: 0, recent: 0, day: 0, total: 0 };
function readPublic(
  url: string,
  signal: AbortSignal,
  maxBytes: number,
  headers?: Record<string, string>,
  missingRobotsAllowed?: false,
): Promise<string>;
function readPublic(
  url: string,
  signal: AbortSignal,
  maxBytes: number,
  headers: Record<string, string>,
  missingRobotsAllowed: true,
): Promise<string | null>;
async function readPublic(
  url: string,
  signal: AbortSignal,
  maxBytes: number,
  headers: Record<string, string> = {},
  missingRobotsAllowed = false,
) {
  signal.throwIfAborted();
  const minute = Math.floor(Date.now() / 60_000),
    day = Math.floor(Date.now() / 86_400_000);
  usage = {
    minute,
    day,
    recent: usage.minute === minute ? usage.recent : 0,
    total: usage.day === day ? usage.total : 0,
  };
  if (usage.recent >= 15 || usage.total >= 150)
    throw new Error("Publix public request limit reached. Retry later.");
  usage.recent++;
  usage.total++;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Stretch/1.0 (+https://github.com/ozemoya/stretch)",
      Accept: "application/json,text/html,text/plain",
      ...headers,
    },
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  // The service currently has no robots file. Other failures still fail closed.
  if (missingRobotsAllowed && response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok || !response.body)
    throw new Error(
      "Publix public source unavailable or blocked. No price was inferred.",
    );
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.length;
      if (bytes > maxBytes)
        throw new Error("Publix response exceeded the size limit.");
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

type Snapshot = {
  raw: unknown;
  storeNumber: string;
  retrievedAt: string;
  expires: number;
};
type Pending = {
  promise: Promise<Snapshot>;
  controller: AbortController;
  users: number;
};
let cached: Snapshot | undefined;
let pending: Pending | undefined;
let retryAfter = 0;
async function fetchSnapshot(signal: AbortSignal): Promise<Snapshot> {
  const pageRules = await readPublic(
    "https://www.publix.com/robots.txt",
    signal,
    100_000,
  );
  if (!robotsAllows(pageRules, pageUrl))
    throw new CrawlingRestricted(
      "Publix crawling rules disallow weekly-ad access.",
    );
  const html = await readPublic(pageUrl, signal, 2_000_000);
  const storeNumber =
    load(html)("weekly-ad-content-root").attr(":geolocated-store-number") ?? "";
  if (!/^[1-9]\d{0,4}$/.test(storeNumber))
    throw new Error("Publix weekly-ad store context could not be verified.");
  const serviceRules = await readPublic(
    "https://services.publix.com/robots.txt",
    signal,
    100_000,
    {},
    true,
  );
  if (serviceRules !== null && !robotsAllows(serviceRules, savingsUrl))
    throw new CrawlingRestricted(
      "Publix crawling rules disallow savings access.",
    );
  const raw: unknown = JSON.parse(
    await readPublic(savingsUrl, signal, 6_000_000, {
      PublixStore: storeNumber,
    }),
  );
  const retrievedAt = new Date().toISOString();
  parsePublixSavings(raw, storeNumber, retrievedAt); // Validate before caching.
  return { raw, storeNumber, retrievedAt, expires: Date.now() + 300_000 };
}

async function weeklyAd(signal?: AbortSignal): Promise<Snapshot> {
  signal?.throwIfAborted();
  if (cached && cached.expires > Date.now()) return cached;
  if (!pending) {
    if (Date.now() < retryAfter)
      throw new Error("Publix public source unavailable; retry in a minute.");
    const controller = new AbortController();
    const task: Pending = {
      controller,
      users: 0,
      promise: fetchSnapshot(controller.signal)
        .then((snapshot) => {
          if (!controller.signal.aborted) cached = snapshot;
          return snapshot;
        })
        .catch((error) => {
          if (!controller.signal.aborted) retryAfter = Date.now() + 60_000;
          throw error;
        })
        .finally(() => {
          if (pending === task) pending = undefined;
        }),
    };
    pending = task;
  }
  const task = pending;
  task.users++;
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      task.promise,
      new Promise<never>((_, reject) => {
        if (signal) {
          abort = () => reject(signal.reason);
          signal.addEventListener("abort", abort, { once: true });
        }
      }),
    ]);
  } finally {
    if (abort) signal?.removeEventListener("abort", abort);
    if (--task.users === 0 && pending === task) {
      pending = undefined;
      task.controller.abort();
    }
  }
}

export const publixScraper: RetailerScraper = {
  id: "publix",
  async scrape(context) {
    const { retailer, items, signal, zip, plan, fast, onReport } = context;
    signal?.throwIfAborted();
    if (providerSupports(retailer)) {
      const reports = await providerReports(
        [retailer],
        items,
        zip,
        true,
        false,
        onReport,
        plan,
        false,
        signal,
        { fast },
      );
      if (reports[0]) return reports[0];
    }
    try {
      if (!items.length)
        return {
          retailer,
          status: "retrieved",
          detail: "No Publix items requested.",
          lines: [],
        };
      const snapshot = await weeklyAd(signal);
      signal?.throwIfAborted();
      const products = parsePublixSavings(
        snapshot.raw,
        snapshot.storeNumber,
        snapshot.retrievedAt,
      );
      const lines: ScrapeReport["lines"] = items.map((item, index) =>
        index >= 12
          ? {
              item,
              products: [],
              searchStatus: "price_unavailable",
              error: "Not searched: twelve-item public catalog limit per run.",
            }
          : {
              item,
              products: products
                .filter((p) => matchesRequestedFood(p.name, item.name))
                .slice(0, 8),
            },
      );
      return {
        retailer,
        status: lines.some((line) => line.products.length)
          ? "retrieved"
          : "failed",
        detail: `Publix public weekly ad for website-selected store ${snapshot.storeNumber}, cached up to five minutes. Limited advertised packages only; nearby branch prices and stock remain unverified.`,
        lines,
      };
    } catch (error) {
      signal?.throwIfAborted();
      return {
        retailer,
        status: error instanceof CrawlingRestricted ? "blocked" : "failed",
        detail:
          "Publix public weekly ad could not be verified. Prices remain unknown.",
        lines: items.map((item) => ({
          item,
          products: [],
          searchStatus:
            error instanceof CrawlingRestricted
              ? "integration_unavailable"
              : "error",
          error:
            error instanceof Error
              ? error.message
              : "Publix public search failed.",
        })),
      };
    }
  },
};
