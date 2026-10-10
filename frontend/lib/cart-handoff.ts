import type { TripReview } from "./trip-review";

// Shopify's documented cart permalink preloads a single merchant's cart.
// Custom storefront domains must be explicitly configured by the operator.
export function shopifyCartUrl(review: TripReview, configuredHosts = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONTS ?? ""): string | null {
  if (!review.products.length) return null;
  const allowed = new Set(configuredHosts.split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
  let host = "";
  const variants = new Map<string, number>();
  for (const product of review.products) {
    let url: URL;
    try { if (!product.productUrl) return null; url = new URL(product.productUrl); } catch { return null; }
    if (url.protocol !== "https:" || url.username || url.password || url.port ||
        !/^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/products\/[^/]+\/?$/i.test(url.pathname)) return null;
    if (!url.hostname.endsWith(".myshopify.com") && !allowed.has(url.hostname.toLowerCase())) return null;
    if (host && url.host !== host) return null;
    host = url.host;
    const variant = url.searchParams.get("variant");
    if (!variant || !/^\d{5,20}$/.test(variant)) return null;
    variants.set(variant, (variants.get(variant) ?? 0) + product.quantity);
  }
  const path = [...variants].map(([id, quantity]) => `${id}:${quantity}`).join(",");
  return path && path.length < 1800 ? `https://${host}/cart/${path}?storefront=true` : null;
}

export function retailerShoppingUrl(review: TripReview): string | null {
  const urls = review.products.map((product) => {
    try { if (!product.productUrl) return null; const url = new URL(product.productUrl); return url.protocol === "https:" ? url : null; }
    catch { return null; }
  });
  if (urls.some((url) => !url) || !urls[0]) return null;
  const host = urls[0].hostname;
  if (urls.some((url) => url?.hostname !== host)) return null;
  const first = urls[0];
  if (host === "www.instacart.com") {
    const slugs = urls.map((url) => url!.pathname.match(/^\/store\/([^/]+)\/products\//)?.[1]);
    if (!slugs[0] || slugs.some((slug) => slug !== slugs[0])) return null;
    return `https://www.instacart.com/store/${encodeURIComponent(slugs[0])}`;
  }
  return `${first.origin}/`;
}

export function canCreateInstacartList(review: TripReview) {
  return review.products.length > 0 && review.products.every((product) => {
    try { return !!product.productUrl && new URL(product.productUrl).hostname === "www.instacart.com"; }
    catch { return false; }
  }) && retailerShoppingUrl(review)?.startsWith("https://www.instacart.com/store/") === true;
}

export function instacartLineItems(review: TripReview) {
  const grouped = new Map<string, { name: string; quantity: number; product_ids?: number[] }>();
  for (const product of review.products) {
    if (!product.productUrl) continue;
    const id = new URL(product.productUrl).pathname.match(/\/products\/(\d+)/)?.[1];
    const key = id ?? product.productUrl;
    const previous = grouped.get(key);
    if (previous) { previous.quantity += product.quantity; continue; }
    grouped.set(key, { name: product.productName, quantity: product.quantity,
      ...(id && Number.isSafeInteger(Number(id)) ? { product_ids: [Number(id)] } : {}) });
  }
  return [...grouped.values()].map((item) => ({ name: item.name,
    line_item_measurements: [{ quantity: item.quantity, unit: "each" }],
    ...(item.product_ids ? { product_ids: item.product_ids } : {}) }));
}

export function copyableShoppingList(review: TripReview) {
  return `${review.storeName}\n${review.storeAddress}\n\n${review.products.map((p) =>
    `${p.quantity} × ${p.productName} (${p.packageSize})${p.productUrl ? ` — ${p.productUrl}` : ""}`,
  ).join("\n")}`;
}
