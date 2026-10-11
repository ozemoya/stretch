import { createClient } from "@supabase/supabase-js";
import type { AgentItem, StoreCheck } from "../price-agent";
import { ownedCandidate } from "../price-agent";
import { packageMatches, normalizedUnitPrice, parseSize } from "../package-match";
import { ownedCatalogProducts } from "../product-ownership";
import { matchesRequestedFood } from "../provider-prices";
import type { StoreCoverage } from "../retailer-coverage";
import type { ScrapeReport } from "../retailer-scraper";
import { resolveStoreCoordinates, validStoreCoordinates } from "../store-coordinates.mjs";

export type PriceLocation = {
  retailer_key: string; scope: "branch" | "catalog"; source_id: string;
  name: string; label: string; address?: string; lat?: number; lon?: number;
};
export type PriceWinner = {
  search_key: string; category: string; catalog_item_id: string; requested_unit: string;
  product_name: string; source_product_id: string; package_size: string; price_cents: number;
  count: number; unit_price: number; unit_basis: string; source_url: string | null;
  price_source: string; observed_at: string;
};
export type PriceBatch = { location: PriceLocation; prices: PriceWinner[] };
export type PriceSaveResult = { status: "saved" | "skipped" | "unconfigured" | "failed"; saved: number; error?: string };
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
export function retailerKey(retailer: string) {
  const canonical = normalized(retailer).replace(/[’‘]/g, "'");
  const known: Record<string, string> = { "kroger family": "kroger", "trader joe's": "trader-joes",
    "the fresh market": "fresh-market", "whole foods": "whole-foods", "albertsons family": "albertsons",
    "food lion": "food-lion", "sam's club": "sams-club", walmart: "walmart", target: "target",
    publix: "publix", aldi: "aldi", lidl: "lidl", sprouts: "sprouts", costco: "costco" };
  return known[canonical] ?? `other-${encodeURIComponent(canonical).replace(/[!'()*]/g,
    character => `%${character.charCodeAt(0).toString(16)}`).toLowerCase()}`;
}
export function locationKey(location: PriceLocation) {
  return `${location.retailer_key}:${location.scope}:${location.source_id}`;
}

type PriceOption = { id: string; name: string; size: string; priceCents: number; observedAt: string; sourceUrl: string | null; priceSource: string };
function lowest(item: AgentItem, candidates: PriceOption[], now: number): PriceWinner | null {
  const eligible = candidates.filter(product =>
    matchesRequestedFood(product.name, item.name) && packageMatches(item.unit, product.size) &&
    Number.isInteger(product.priceCents) && product.priceCents > 0 && product.priceCents <= 100000 &&
    Number.isFinite(Date.parse(product.observedAt)) && Date.parse(product.observedAt) <= now + 300000 &&
    Date.parse(product.observedAt) >= now - 86400000);
  eligible.sort((a, b) => a.priceCents - b.priceCents || Date.parse(b.observedAt) - Date.parse(a.observedAt) || a.id.localeCompare(b.id));
  const winner = eligible[0];
  if (!winner) return null;
  const unitPrice = normalizedUnitPrice(winner.priceCents, winner.size), requested = parseSize(item.unit), size = parseSize(winner.size);
  if (!unitPrice || !requested || !size) return null;
  return {
    search_key: JSON.stringify([normalized(item.name), requested.kind, Number(requested.amount.toPrecision(8))]),
    category: normalized(item.name), catalog_item_id: item.id, requested_unit: item.unit,
    product_name: winner.name, source_product_id: winner.id, package_size: winner.size,
    price_cents: winner.priceCents, count: size.kind === "count" && Number.isSafeInteger(size.amount) ? size.amount : 1,
    unit_price: unitPrice.baseCents / 100, unit_basis: unitPrice.baseUnit,
    source_url: winner.sourceUrl, price_source: winner.priceSource, observed_at: winner.observedAt,
  };
}

export function catalogPriceBatch(report: ScrapeReport, zip: string, now = Date.now()): PriceBatch {
  if (!/^\d{5}$/.test(zip)) throw new Error("A ZIP is required for catalog price storage.");
  return {
    location: { retailer_key: retailerKey(report.retailer), scope: "catalog", source_id: `zip:${zip}`,
      name: report.retailer, label: `Online catalog · ZIP ${zip}` },
    prices: report.lines.flatMap(line => {
      const winner = lowest(line.item, ownedCatalogProducts(report, line.products)
        .filter(product => product.matchKind !== "alternative")
        .map(product => ({ id: product.id, name: product.name, size: product.size, priceCents: product.priceCents,
          observedAt: product.retrievedAt, sourceUrl: product.sourceUrl, priceSource: report.detail })), now);
      return winner ? [winner] : [];
    }),
  };
}

export function branchPriceBatch(store: StoreCheck, coverage: StoreCoverage[], now = Date.now()): PriceBatch {
  const row = coverage.find(entry => entry.id === store.id && entry.retailer === store.retailerId);
  let sourceId = store.sourceLocationId ?? `osm:${store.id}`;
  if (store.retailerId === "Kroger family" && store.sourceLocationId) {
    if (!/^\d+$/.test(sourceId)) throw new Error("Invalid native Kroger location ID.");
    sourceId = BigInt(sourceId).toString();
  }
  return {
    location: { retailer_key: retailerKey(store.retailerId), scope: "branch", source_id: sourceId,
      name: store.retailerId === "Kroger family" ? "Kroger" : store.retailerId,
      label: store.name, address: store.address || row?.address,
      ...(store.coordinates ? { lat: store.coordinates.lat, lon: store.coordinates.lon }
        : row ? { lat: row.lat, lon: row.lon } : {}) },
    prices: !row ? [] : store.lines.flatMap(line => {
      const winner = lowest(line.item, line.candidates.filter(product => ownedCandidate(store, product))
        .filter(product => /^(?:each|unit)$/i.test(product.soldBy))
        .map(product => ({ id: product.productId, name: product.name, size: product.size,
          priceCents: product.regularCents!, observedAt: product.verifiedAt, sourceUrl: product.productUrl,
          priceSource: product.priceSource })), now);
      return winner ? [winner] : [];
    }),
  };
}

export type PriceDatabase = {
  rpc(name: "save_store_prices", args: { p_location: PriceLocation; p_prices: PriceWinner[] }):
    PromiseLike<{ data: unknown; error: unknown }>;
  storedLocation?(key: string): Promise<{ latitude: number | null; longitude: number | null; address: string | null } | null>;
};
function configuredDatabase(): PriceDatabase | null {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(5000) }) } });
  return {
    rpc: (name, args) => client.rpc(name, args),
    async storedLocation(key) {
      const { data, error } = await client.from("store").select("latitude,longitude,address").eq("location_key", key).maybeSingle();
      if (error) throw new Error("Saved store coordinates could not be read.");
      return data;
    },
  };
}

/** Never write from a browser or accept client-supplied prices. The RPC is service-role-only. */
export async function savePriceBatch(batch: PriceBatch, database?: PriceDatabase | null): Promise<PriceSaveResult> {
  if (!batch.prices.length) return { status: "skipped", saved: 0 };
  const db = database === undefined ? configuredDatabase() : database;
  if (!db) return { status: "unconfigured", saved: 0, error: "Supabase server credentials are not configured." };
  // Different UI item IDs can describe the same food and amount. Persist one winner for that key.
  const unique = new Map<string, PriceWinner>();
  for (const price of batch.prices) {
    const previous = unique.get(price.search_key);
    if (!previous || price.price_cents < previous.price_cents) unique.set(price.search_key, price);
  }
  try {
    let location = batch.location;
    if (location.scope === "branch") {
      let input = { latitude: location.lat, longitude: location.lon, address: location.address };
      if (!validStoreCoordinates(input.latitude, input.longitude)) {
        const stored = await db.storedLocation?.(locationKey(location));
        if (stored && validStoreCoordinates(stored.latitude, stored.longitude))
          input = { latitude: stored.latitude!, longitude: stored.longitude!, address: stored.address ?? location.address };
        else input.address ||= stored?.address ?? undefined;
      }
      const point = await resolveStoreCoordinates(input);
      if (!point) return { status: "failed", saved: 0, error: "The physical store could not be located from its coordinates or street address. Prices were not saved to an unlocated branch." };
      location = { ...location, lat: point.latitude, lon: point.longitude };
    }
    const { data, error } = await db.rpc("save_store_prices", { p_location: location, p_prices: [...unique.values()] });
    if (error || !Array.isArray(data) || data.length !== unique.size)
      return { status: "failed", saved: 0, error: "Supabase could not confirm the price save. Apply the modular_scraper_prices and store_location_key migrations and check server permissions." };
    return { status: "saved", saved: data.length };
  } catch {
    return { status: "failed", saved: 0, error: "Supabase price save did not complete." };
  }
}
