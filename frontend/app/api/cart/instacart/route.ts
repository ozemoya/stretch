import { canCreateInstacartList, instacartLineItems } from "@/lib/cart-handoff";
import { parseTripReview } from "@/lib/trip-review";

const cache = new Map<string, { url: string; expiresAt: number }>();
const attempts = new Map<string, { count: number; expiresAt: number }>();

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    return Response.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 50_000)
    return Response.json({ error: "Trip is too large." }, { status: 413 });
  const key = process.env.INSTACART_API_KEY;
  if (!key) return Response.json({ error: "Instacart cart handoff is not connected yet." }, { status: 503 });
  const client = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const previous = attempts.get(client);
  const count = previous && previous.expiresAt > Date.now() ? previous.count : 0;
  if (count >= 15) return Response.json({ error: "Too many shopping lists. Try later." }, { status: 429 });
  attempts.set(client, { count: count + 1, expiresAt: Date.now() + 60 * 60 * 1000 });
  let input: unknown;
  try { input = await request.json(); } catch { return Response.json({ error: "Invalid trip." }, { status: 400 }); }
  const review = parseTripReview(input);
  if (!review || !canCreateInstacartList(review))
    return Response.json({ error: "This retailer cannot use the Instacart list handoff." }, { status: 400 });
  const lineItems = instacartLineItems(review);
  const cacheKey = JSON.stringify(lineItems);
  const saved = cache.get(cacheKey);
  if (saved && saved.expiresAt > Date.now()) return Response.json({ url: saved.url, kind: "shopping_list" });

  const base = process.env.INSTACART_API_ENV === "production"
    ? "https://connect.instacart.com" : "https://connect.dev.instacart.tools";
  try {
    const response = await fetch(`${base}/idp/v1/products/products_link`, {
      method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json",
        Authorization: `Bearer ${key}` },
      body: JSON.stringify({ title: `${review.storeName} shopping list from Stretch`,
        link_type: "shopping_list", line_items: lineItems }),
      signal: AbortSignal.timeout(8_000), cache: "no-store",
    });
    if (!response.ok) return Response.json({ error: "The retailer list service could not create a shopping link." }, { status: 502 });
    const data: unknown = await response.json();
    const url = typeof data === "object" && data !== null && "products_link_url" in data
      ? (data as { products_link_url: unknown }).products_link_url : null;
    if (typeof url !== "string" || !/^https:\/\/(www\.)?instacart\.com\/store\/shopping_lists\//.test(url))
      return Response.json({ error: "The retailer list service returned an invalid link." }, { status: 502 });
    cache.set(cacheKey, { url, expiresAt: Date.now() + 60 * 60 * 1000 });
    return Response.json({ url, kind: "shopping_list" });
  } catch {
    return Response.json({ error: "The retailer list service did not respond in time." }, { status: 504 });
  }
}
