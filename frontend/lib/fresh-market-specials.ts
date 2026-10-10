import { load } from "cheerio";
import { z } from "zod";
import type { NearbyPlace } from "./live-data";
import type { AgentItem } from "./price-agent";
import type { ScrapeReport, ScrapedProduct } from "./retailer-scraper";
import observations from "./fresh-market-observations.json";

const normalizeAddress = (value: string) =>
  value
    .toLowerCase()
    .replace(/\broad\b/g, "rd")
    .replace(/[.,]/g, "")
    .replace(/\b(?:ne|nw|se|sw)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();

export function freshMarketObservedReport(
  places: NearbyPlace[],
  items: AgentItem[],
  now = new Date(),
): ScrapeReport {
  const nearby = places.filter(
    (place) =>
      place.kind === "grocery" &&
      /fresh market/i.test(`${place.brand ?? ""} ${place.name}`),
  );
  const lines = items.map((item) => ({
    item,
    products:
      item.name.trim().toLowerCase() === "milk"
        ? observations
            .filter(
              (observation) =>
                nearby.some((place) =>
                  normalizeAddress(place.address).startsWith(
                    normalizeAddress(observation.storeAddress),
                  ),
                ) &&
                now.getTime() >= Date.parse(observation.retrievedAt) &&
                now.getTime() - Date.parse(observation.retrievedAt) <
                  86_400_000,
            )
            .map((observation) => ({
              id: observation.id,
              name: observation.name,
              brand: observation.brand,
              size: observation.size,
              priceCents: observation.priceCents,
              sourceUrl: observation.sourceUrl,
              imageUrl: observation.imageUrl,
              retrievedAt: observation.retrievedAt,
              verification: "official-page-observation" as const,
              ...(item.unit.toLowerCase() !== observation.size.toLowerCase()
                ? { matchKind: "alternative" as const }
                : {}),
            }))
        : [],
  }));
  return {
    retailer: "The Fresh Market",
    status: lines.some((line) => line.products.length) ? "retrieved" : "failed",
    detail:
      "In-Store website prices observed for 2099 Peachtree Road NE; observations expire after 24 hours. The displayed package, branch, availability and checkout price must be confirmed before buying. Weekly specials are checked separately.",
    lines,
  };
}

const branch = z.object({
  storeNumber: z.number().int().positive(),
  address: z.string(),
  city: z.string(),
  isClosed: z.boolean(),
  storeLocation: z.object({ lat: z.number(), lon: z.number() }),
});
const board = z.object({
  startDate: z.string(),
  endDate: z.string(),
  applicableStoresCollection: z.object({ items: z.array(z.unknown()) }),
  specialItemsCollection: z.object({
    items: z.array(z.unknown()),
  }),
});
const special = z.object({
  sys: z.object({ id: z.string() }),
  specialItemName: z.string(),
  specialMarketingPrice: z.string(),
  product: z.object({ description: z.string().nullable() }).nullable(),
});
export function parseFreshMarketSpecials(
  html: string,
  places: NearbyPlace[],
  items: AgentItem[],
  now = new Date(),
): ScrapeReport {
  const $ = load(html);
  let raw;
  try {
    raw = JSON.parse($("#__NEXT_DATA__").text()).props?.pageProps
      ?.weeklySpecialsContent;
  } catch {
    throw new Error("Weekly offer data could not be read.");
  }
  if (!raw || typeof raw !== "object")
    throw new Error("Weekly offer data missing.");
  const matched = new Map<string, ScrapedProduct>();
  const addresses = new Set<string>();
  for (const value of Object.values(raw)) {
    const parsed = board.safeParse(value);
    if (!parsed.success) continue;
    const b = parsed.data,
      start = Date.parse(b.startDate),
      end = Date.parse(b.endDate);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      now.getTime() < start ||
      now.getTime() > end
    )
      continue;
    const local = b.applicableStoresCollection.items
      .flatMap((raw) => {
        const s = branch.safeParse(raw);
        return s.success ? [s.data] : [];
      })
      .find(
        (s) =>
          !s.isClosed &&
          places.some(
            (p) =>
              /fresh market/i.test(`${p.brand ?? ""} ${p.name}`) &&
              Math.abs(p.lat - s.storeLocation.lat) < 0.001 &&
              Math.abs(p.lon - s.storeLocation.lon) < 0.001 &&
              p.address.match(/^\d+/)?.[0] === s.address.match(/^\d+/)?.[0],
          ),
      );
    if (!local) continue;
    addresses.add(`${local.address}, ${local.city}`);
    for (const raw of b.specialItemsCollection.items) {
      const parsedItem = special.safeParse(raw);
      if (!parsedItem.success) continue;
      const p = parsedItem.data;
      // Never derive a price from BOGO, percent-off, starting-at or multibuy offers.
      const price = p.specialMarketingPrice.match(
        /^\$(\d+\.\d{2})\s+(ea|lb)$/i,
      );
      if (!price) continue;
      const cents = Math.round(Number(price[1]) * 100);
      if (cents <= 0) continue;
      matched.set(`${local.storeNumber}-${p.sys.id}`, {
        id: `${local.storeNumber}-${p.sys.id}`,
        name: p.specialItemName,
        brand: "The Fresh Market",
        size: `${price[2].toLowerCase() === "lb" ? "per lb" : "each"}${p.product?.description ? ` · ${p.product.description}` : ""} · offer ends ${b.endDate.slice(0, 10)}`,
        priceCents: cents,
        sourceUrl: `https://www.thefreshmarket.com/features/weekly-features?storeNumber=${local.storeNumber}`,
        retrievedAt: now.toISOString(),
      });
    }
  }
  const lines = items.map((item) => {
    const tokens = item.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((t) => t.replace(/s$/, ""));
    return {
      item,
      products: [...matched.values()]
        .filter((p) => {
          const words = p.name
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .map((t) => t.replace(/s$/, ""));
          return tokens.length && tokens.every((t) => words.includes(t));
        })
        .slice(0, 8),
    };
  });
  return {
    retailer: "The Fresh Market",
    status: lines.some((l) => l.products.length) ? "retrieved" : "failed",
    detail: addresses.size
      ? `Current weekly advertised offers matched by address and coordinates to ${[...addresses].join("; ")}. Limited sale items only; per-pound prices are rates, not package totals. Stock is unverified. Excluded from full basket rankings.`
      : "No current weekly offer board matched a nearby physical branch. Prices remain unknown.",
    lines,
  };
}
let cached: { html: string; expires: number } | undefined;
let lastAttempt = 0;
export async function freshMarketSpecials(
  places: NearbyPlace[],
  items: AgentItem[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!cached || cached.expires <= Date.now()) {
    if (Date.now() - lastAttempt < 60000)
      throw new Error("Weekly offer source unavailable; retry in a minute.");
    lastAttempt = Date.now();
    const robots = await fetch("https://www.thefreshmarket.com/robots.txt", {
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      redirect: "error",
    });
    if (!robots.ok) throw new Error("Weekly offer crawling rules unavailable.");
    const rules = await robots.text();
    if (
      /^Disallow:[ \t]*(?:\/|\/features\/?|\/features\/weekly-features)[ \t]*$/im.test(
        rules,
      )
    )
      throw new Error("Weekly offer crawling restricted.");
    const r = await fetch(
      "https://www.thefreshmarket.com/features/weekly-features",
      {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
        redirect: "error",
        cache: "no-store",
        headers: {
          "User-Agent": "Stretch/1.0 (+https://github.com/ozemoya/stretch)",
        },
      },
    );
    if (!r.ok) throw new Error("Weekly offer source unavailable.");
    const html = await r.text();
    if (html.length > 1000000)
      throw new Error("Weekly offer response too large.");
    cached = { html, expires: Date.now() + 300000 };
  }
  return parseFreshMarketSpecials(cached.html, places, items);
}
