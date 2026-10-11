import { getCatalog } from "@/lib/catalog";
import { input } from "@/lib/compare-basket";
import type { AgentItem, Candidate, StoreCheck } from "@/lib/price-agent";

export const runtime = "nodejs";

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function matchesProduct(item: AgentItem, product: { id: string; name: string }) {
  const requested = normalized(item.name);
  const id = normalized(product.id);
  const name = normalized(product.name);
  return requested === id || requested === name ||
    name.includes(requested) || requested.includes(name);
}

function mapUrl(
  origin: { lat: number; lon: number } | undefined,
  store: { latitude?: number | null; longitude?: number | null },
) {
  if (!origin || store.latitude == null || store.longitude == null) return "";
  const destination = `${store.latitude},${store.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lon}&destination=${destination}&travelmode=driving`;
}

function toCandidate(
  offer: {
    productId: string;
    storeId: string;
    priceCents: number;
    recordedAt: string;
    productName?: string | null;
    packageSize?: string | null;
    sourceUrl?: string | null;
    priceSource?: string | null;
    unitBasis?: string | null;
    requestedUnit?: string | null;
  },
  product: { id: string; name: string; unit: string },
): Candidate {
  const price = offer.priceCents / 100;
  return {
    id: `${offer.productId}:${offer.storeId}`,
    name: offer.productName || product.name,
    brand: "",
    size: offer.packageSize || offer.requestedUnit || product.unit,
    soldBy: offer.unitBasis === "per_lb" ? "WEIGHT" : "UNIT",
    regularCents: offer.priceCents,
    retrievedAt: offer.recordedAt,
    retailerId: offer.storeId,
    storeLocationId: offer.storeId,
    productId: offer.productId,
    productName: offer.productName || product.name,
    price,
    priceSource: offer.priceSource || "Supabase product table",
    verifiedAt: offer.recordedAt,
    productUrl: offer.sourceUrl || null,
    matchKind: "exact",
  };
}

export async function POST(request: Request) {
  const parsed = input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Choose 1–30 distinct foods and a valid search location." },
      { status: 400 },
    );
  }

  try {
    const { catalog } = await getCatalog();
    const products = new Map(catalog.products.map((product) => [product.id, product]));
    const offersByStore = new Map<string, typeof catalog.offers>();
    for (const offer of catalog.offers) {
      if (!offer.available) continue;
      const storeOffers = offersByStore.get(offer.storeId) ?? [];
      storeOffers.push(offer);
      offersByStore.set(offer.storeId, storeOffers);
    }

    const storesWithCoordinates = catalog.stores.filter(
      (store) =>
        typeof store.latitude === "number" &&
        Number.isFinite(store.latitude) &&
        typeof store.longitude === "number" &&
        Number.isFinite(store.longitude),
    );
    const stores: StoreCheck[] = storesWithCoordinates.flatMap((store) => {
      const offers = offersByStore.get(store.id) ?? [];
      const lines = parsed.data.items.map((item) => {
        const candidates = offers.flatMap((offer) => {
          const product = products.get(offer.productId);
          return product && matchesProduct(item, product)
            ? [toCandidate(offer, product)]
            : [];
        });
        return {
          item,
          candidates,
          searchStatus: candidates.length ? "completed" as const : "no_results" as const,
          ...(candidates.length ? {} : { error: "No matching Supabase product price for this store." }),
        };
      });
      const coordinates = store.latitude != null && store.longitude != null
        ? { lat: store.latitude, lon: store.longitude }
        : undefined;
      return [{
        id: store.id,
        retailerId: store.id,
        name: store.name,
        address: store.address || "Address not listed",
        coordinates,
        requestedItemIds: parsed.data.items.map((item) => item.id),
        lines,
      }];
    });

    const origin = parsed.data.origin;
    const storeCoverage = storesWithCoordinates.map((store) => ({
      id: store.id,
      name: store.name,
      address: store.address || "Address not listed",
      miles: 0,
      lat: store.latitude ?? 0,
      lon: store.longitude ?? 0,
      mapUrl: mapUrl(origin, store),
      retailer: store.id,
      status: "checked" as const,
      detail: "Prices loaded from Supabase product records.",
    }));
    const result = {
      stores,
      storeCoverage,
      foundStores: stores.length,
      publicCatalogs: [],
      warnings: storesWithCoordinates.length === catalog.stores.length
        ? []
        : ["Stores without Supabase coordinates were excluded from routed results."],
      coverage: `Loaded ${stores.length} stores and product prices from Supabase.`,
      checkedAt: new Date().toISOString(),
      agent: {
        aiConnected: false,
        mode: "Supabase-only product search; no live retailer or web results are included.",
      },
      search: { elapsedMs: 0, partial: false, timedOut: false, locationError: null },
    };
    const body = [
      JSON.stringify({ type: "started", deadlineMs: 0 }),
      JSON.stringify({ type: "complete", result }),
      "",
    ].join("\n");
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Supabase catalog search failed." },
      { status: 502 },
    );
  }
}
